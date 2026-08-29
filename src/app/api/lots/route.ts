import { eq } from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/lib/db";
import { auctions, categories } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { apiError, apiOk, handleRouteError } from "@/lib/api";
import { parseToCents } from "@/lib/auction/money";
import { env } from "@/lib/env";

/* -------------------------------------------------------------------------- */
/* Money parsing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A price arrives from the form as whatever the seller typed — "1,250",
 * "$1250.50", or a JSON number. It becomes an integer number of cents here, at
 * the edge, and stays an integer for the rest of its life. Nothing downstream
 * ever sees a float, so no lot can be listed at 1249.9999999999998.
 */
function moneyCents(label: string) {
  return z.union([z.string(), z.number()]).transform((raw, ctx) => {
    const cents = parseToCents(typeof raw === "number" ? String(raw) : raw);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: `${label} is not a valid amount.` });
      return z.NEVER;
    }
    if (!Number.isSafeInteger(cents)) {
      ctx.addIssue({ code: "custom", message: `${label} is larger than we can record.` });
      return z.NEVER;
    }
    return cents;
  });
}

/** Empty strings and nulls both mean "the seller left this off". */
const optionalMoneyCents = (label: string) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((raw, ctx) => {
      if (raw === null || raw === undefined) return null;
      if (typeof raw === "string" && raw.trim() === "") return null;
      const cents = parseToCents(typeof raw === "number" ? String(raw) : raw);
      if (cents === null || !Number.isSafeInteger(cents)) {
        ctx.addIssue({ code: "custom", message: `${label} is not a valid amount.` });
        return z.NEVER;
      }
      return cents;
    });

/* -------------------------------------------------------------------------- */
/* Request shape                                                               */
/* -------------------------------------------------------------------------- */

const MIN_STARTING_CENTS = 100; // $1 — below this the increment ladder is farcical
const MAX_IMAGES = 8;
const MAX_LEAD_DAYS = 90;
const CLOCK_SLACK_MS = 5 * 60 * 1000; // tolerate a client clock a few minutes behind

const imageRef = z
  .string()
  .trim()
  .min(1, "An image reference cannot be blank.")
  .max(600)
  .refine(
    // https or a site-relative path only. Plain http would be blocked by the
    // browser as mixed content on our TLS origin anyway, and every other scheme
    // (javascript:, data:, blob:) is turned away here rather than relied upon
    // being inert wherever the URL eventually lands.
    (value) => value.startsWith("/") || /^https:\/\//i.test(value),
    "Images must be an https URL or a path beginning with /.",
  );

const CreateLotSchema = z.object({
  title: z.string().trim().min(4, "Give the lot a title.").max(140),
  description: z.string().trim().min(10, "Describe the lot in a sentence or two.").max(8_000),
  provenance: z.string().trim().max(4_000).optional().nullable(),
  categoryId: z.string().trim().min(1).optional().nullable(),
  condition: z.enum(["mint", "excellent", "good", "fair", "restoration"]),
  images: z.array(imageRef).min(1, "At least one image is required.").max(MAX_IMAGES),

  startingPrice: moneyCents("The starting price"),
  reservePrice: optionalMoneyCents("The reserve"),
  buyNowPrice: optionalMoneyCents("The Buy Now price"),

  type: z.enum(["timed", "live"]),
  startsAt: z.iso.datetime({ offset: true }),
  durationHours: z.number().int().min(1).max(24 * 30),
});

/* -------------------------------------------------------------------------- */
/* Slugs                                                                       */
/* -------------------------------------------------------------------------- */

/** Lowercase and unambiguous: no 0/O or 1/l to misread in a shared link. */
const slugSuffix = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 6);

function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return base || "lot";
}

/** Postgres unique_violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/* -------------------------------------------------------------------------- */
/* POST /api/lots — consign a lot                                              */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return apiError("unauthorized", "Sign in to consign a lot.", 401);

    const body = CreateLotSchema.parse(await request.json());

    /* -- Price rules. Re-checked here because the client's copy of these
          rules is a convenience, not an authority. -------------------------- */
    if (body.startingPrice < MIN_STARTING_CENTS) {
      return apiError("invalid_price", "The starting price must be at least $1.", 422, {
        field: "startingPrice",
      });
    }
    if (body.reservePrice !== null && body.reservePrice < body.startingPrice) {
      return apiError(
        "invalid_reserve",
        "The reserve cannot be below the starting price — the lot could sell under its own floor.",
        422,
        { field: "reservePrice" },
      );
    }
    if (body.buyNowPrice !== null && body.buyNowPrice <= body.startingPrice) {
      return apiError(
        "invalid_buy_now",
        "Buy Now must be above the starting price, or nobody would ever bid.",
        422,
        { field: "buyNowPrice" },
      );
    }
    if (
      body.buyNowPrice !== null &&
      body.reservePrice !== null &&
      body.buyNowPrice < body.reservePrice
    ) {
      return apiError(
        "invalid_buy_now",
        "Buy Now cannot be below your reserve — you would be selling under your own floor.",
        422,
        { field: "buyNowPrice" },
      );
    }

    /* -- Timing. The clock belongs to the server. ------------------------- */
    const now = new Date();
    const startsAt = new Date(body.startsAt);
    if (startsAt.getTime() < now.getTime() - CLOCK_SLACK_MS) {
      return apiError("invalid_schedule", "The start time is in the past.", 422, {
        field: "startsAt",
      });
    }
    if (startsAt.getTime() > now.getTime() + MAX_LEAD_DAYS * 86_400_000) {
      return apiError(
        "invalid_schedule",
        `A lot cannot be scheduled more than ${MAX_LEAD_DAYS} days ahead.`,
        422,
        { field: "startsAt" },
      );
    }
    // Derived server-side rather than accepted from the body: the close time
    // decides who wins, so a client clock must never get a vote in it.
    const endsAt = new Date(startsAt.getTime() + body.durationHours * 3_600_000);

    /* -- Category must be one of ours, not an id somebody made up. -------- */
    let categoryId: string | null = null;
    if (body.categoryId) {
      const [category] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, body.categoryId))
        .limit(1);
      if (!category) {
        return apiError("invalid_category", "That category does not exist.", 422, {
          field: "categoryId",
        });
      }
      categoryId = category.id;
    }

    const values = {
      sellerId: session.user.id,
      categoryId,
      title: body.title,
      description: body.description,
      provenance: body.provenance?.trim() ? body.provenance.trim() : null,
      condition: body.condition,
      images: body.images,
      type: body.type,
      // Live now if the seller opened it now; otherwise it waits for the
      // scheduler (or the lazy promotion inside the bid engine) to open it.
      status: startsAt.getTime() > now.getTime() ? ("scheduled" as const) : ("live" as const),
      startingPriceCents: body.startingPrice,
      reservePriceCents: body.reservePrice,
      buyNowPriceCents: body.buyNowPrice,
      // Nobody has bid, so the ask IS the starting price.
      currentPriceCents: body.startingPrice,
      buyersPremiumBps: env().BUYERS_PREMIUM_BPS,
      startsAt,
      endsAt,
      // Preserved so a soft-close extension can later be shown as "extended
      // from" rather than silently moving the advertised close.
      originalEndsAt: endsAt,
      reserveMet: body.reservePrice === null,
    };

    /* -- Insert, retrying only the slug. ---------------------------------- */
    const base = slugify(body.title);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = `${base}-${slugSuffix()}`;
      try {
        const [created] = await db
          .insert(auctions)
          .values({ id: `a_${nanoid(16)}`, slug, ...values })
          .returning({
            id: auctions.id,
            slug: auctions.slug,
            status: auctions.status,
            startsAt: auctions.startsAt,
            endsAt: auctions.endsAt,
            currentPriceCents: auctions.currentPriceCents,
          });
        return apiOk({ lot: created }, 201);
      } catch (error) {
        // A six-character suffix collides about never; if it does, try again
        // rather than handing the seller a 500 for a coin flip.
        if (isUniqueViolation(error) && attempt < 4) continue;
        throw error;
      }
    }

    return apiError("slug_conflict", "Could not allocate a URL for that title.", 409);
  } catch (error) {
    return handleRouteError(error);
  }
}
