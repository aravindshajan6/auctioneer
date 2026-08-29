/**
 * Demo seed.
 *
 * Run with `npx tsx scripts/seed.ts`. Safe to re-run: it truncates the domain
 * tables first, so the second run produces the same catalogue as the first.
 *
 * Two rules shape everything below.
 *
 * 1. Nothing writes a bid, a wallet balance or a ledger line by hand. Bids go
 *    through `placeBid` and closures through `closeAuction`, so the seeded
 *    prices, bid counts, deposits, orders and ledger are consistent with the
 *    engine's own rules rather than with a fixture author's guess at them. A
 *    seed that fakes its own numbers is a seed that hides engine bugs.
 *
 * 2. Every random choice comes from a fixed-seed PRNG. Re-seeding must not
 *    churn `public/lots` or renumber the catalogue.
 *
 * 3. The lots describe REAL objects. Titles, materials, dimensions, credit
 *    lines and — where the institution publishes one — provenance come from
 *    the open-access collections of the Art Institute of Chicago, the Met, the
 *    V&A and Open Library. A demo catalogue of invented masterpieces teaches
 *    nobody what a catalogue note actually has to hold. Two departments have
 *    no free source (motor cars, wine) and keep their written entries, and if
 *    every museum is unreachable the whole catalogue falls back to them, so
 *    `npm run db:seed` still works on a train. `SEED_OFFLINE=1` forces that
 *    path for testing.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, pool } from "../src/lib/db";
import * as t from "../src/lib/db/schema";
import { auth } from "../src/lib/auth";
import { credit } from "../src/lib/wallet/ledger";
import { closeAuction, placeBid } from "../src/lib/auction/engine";
import { incrementFor } from "../src/lib/auction/increments";
import { writeAvatar, writeHousePlates, writeLotArt } from "./generate-art";
import { fetchAic } from "./sources/aic";
import { downloadLotImages, pruneStalePlates } from "./sources/images";
import { fetchMet } from "./sources/met";
import { fetchOpenLibrary } from "./sources/openlibrary";
import { fetchVam } from "./sources/vam";
import type { SourceObject } from "./sources/types";

/* -------------------------------------------------------------------------- */
/* Deterministic helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A local mulberry32 rather than an import from the art generator: the seed's
 * randomness and the artwork's must be able to drift apart without one
 * silently re-rendering the other's output.
 */
function makeRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}

const rand = makeRandom(0x4155_4354); // "AUCT"

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Fixed clock origin so every timestamp in one run is relative to one instant. */
const NOW = Date.now();
const at = (offsetMs: number) => new Date(NOW + offsetMs);

/** Dollars -> integer cents. The only place a decimal is allowed near money. */
const usd = (dollars: number) => Math.round(dollars * 100);

/** Join paragraphs the way the catalogue renders them. */
const para = (...paragraphs: string[]) => paragraphs.join("\n\n");

const used = new Set<string>();
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 68)
    .replace(/-+$/g, "");
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

/* -------------------------------------------------------------------------- */
/* 1. Wipe                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Idempotency by demolition.
 *
 * This is a demo database whose entire contents are this file's output, so the
 * cheapest correct reset is to empty every domain table. Truncating `user`
 * cascades through wallets, bids, auctions and orders, which is exactly the
 * closure we want — a partial delete would strand ledger rows behind their
 * wallets. Do NOT point this script at anything you would miss.
 */
async function wipe() {
  await db.execute(sql`
    truncate table
      reviews, orders, bid_deposits, ledger_entries, wallets,
      chat_messages, notifications, watchlist, auction_events, bids,
      auctions, sales, categories,
      "session", account, verification, "user"
    restart identity cascade
  `);
}

/* -------------------------------------------------------------------------- */
/* 2. Categories                                                               */
/* -------------------------------------------------------------------------- */

/** `icon` values are lucide-react component names; the UI resolves them by name. */
const CATEGORIES = [
  {
    key: "timepieces",
    name: "Timepieces",
    icon: "Watch",
    accent: "#c8a24a",
    description:
      "Wristwatches and pocket watches of consequence — complications, first series, and references with a documented history.",
  },
  {
    key: "fine-art",
    name: "Fine Art",
    icon: "Palette",
    accent: "#b4553f",
    description:
      "Paintings, works on paper and sculpture from the post-war period to the present, together with selected Old Master impressions.",
  },
  {
    key: "jewellery-gems",
    name: "Jewellery & Gems",
    icon: "Gem",
    accent: "#5fb7c9",
    description:
      "Signed period jewellery and unmounted stones, each accompanied by current laboratory reports where the market expects them.",
  },
  {
    key: "automobilia",
    name: "Automobilia",
    icon: "Car",
    accent: "#8f2f36",
    description:
      "Motor cars offered without reserve or with, plus the badges, tools and forecourt ephemera that surround them.",
  },
  {
    key: "antiquities",
    name: "Antiquities",
    icon: "Amphora",
    accent: "#a08655",
    description:
      "Greek, Roman, Egyptian and Near Eastern works of art, offered only with pre-1970 provenance on file.",
  },
  {
    key: "modern-design",
    name: "Modern Design",
    icon: "Armchair",
    accent: "#6f9a86",
    description:
      "Twentieth-century furniture, glass and lighting by the studios and ateliers that defined the century's material language.",
  },
  {
    key: "rare-books",
    name: "Rare Books & Manuscripts",
    icon: "BookOpen",
    accent: "#7b6ca8",
    description:
      "Landmark printing, illuminated manuscripts, association copies and archives, collated and described leaf by leaf.",
  },
  {
    key: "wine-spirits",
    name: "Wine & Spirits",
    icon: "Wine",
    accent: "#6d2438",
    description:
      "Mature Bordeaux and Burgundy, grower Champagne and single-cask spirits, inspected and stored under temperature control.",
  },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

/* -------------------------------------------------------------------------- */
/* 3. People                                                                   */
/* -------------------------------------------------------------------------- */

interface PersonaSpec {
  key: string;
  email: string;
  password: string;
  name: string;
  handle: string;
  role: "bidder" | "seller" | "admin";
  bio: string;
  location: string;
  fundsCents: number;
  sellerVerified?: boolean;
  ratingAvg?: number; // stars * 100
  ratingCount?: number;
}

/**
 * Only the two showcase logins below are meant to be public — a demo whose
 * front door is a dead end is a demo nobody sees. Every *other* seeded account,
 * the admin included, gets a random password per run so that a guessable
 * pattern like "admin1234" can never reach a deployed database. Set
 * SEED_PASSWORD to pin it when you need to log in as one of them.
 */
const PRIVATE_SEED_PASSWORD =
  process.env.SEED_PASSWORD ?? randomBytes(18).toString("base64url");

/** The three accounts printed at the end of the run. */
const DEMO_LOGINS = [
  { email: "demo@auctioneer.dev", password: "demo1234", role: "bidder" },
  { email: "seller@auctioneer.dev", password: "seller1234", role: "seller" },
  { email: "admin@auctioneer.dev", password: PRIVATE_SEED_PASSWORD, role: "admin" },
] as const;

const PEOPLE: PersonaSpec[] = [
  {
    key: "ava",
    email: "demo@auctioneer.dev",
    password: "demo1234",
    name: "Ava Sinclair",
    handle: "avasinclair",
    role: "bidder",
    bio: "Collects mid-century design and anything with a movement in it. Bids late, rarely twice.",
    location: "New York, NY",
    fundsCents: usd(250_000),
    ratingAvg: 480,
    ratingCount: 34,
  },
  {
    key: "marcus",
    email: "seller@auctioneer.dev",
    password: "seller1234",
    name: "Marcus Vale",
    handle: "valeandco",
    role: "seller",
    bio: "Vale & Co., est. 1988. Horology, motor cars, and the occasional thing that fits in neither category.",
    location: "London, United Kingdom",
    fundsCents: usd(50_000),
    sellerVerified: true,
    ratingAvg: 487,
    ratingCount: 213,
  },
  {
    key: "iris",
    email: "admin@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Iris Okonkwo",
    handle: "iris",
    role: "admin",
    bio: "Head of sale. Twelve years on the rostrum; still counts the room before the hammer falls.",
    location: "New York, NY",
    fundsCents: usd(100_000),
    ratingAvg: 500,
    ratingCount: 61,
  },

  /* -- Consignors ------------------------------------------------------- */
  {
    key: "rafael",
    email: "rafael.ortiz@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Rafael Ortiz-Bennett",
    handle: "ortizbennett",
    role: "seller",
    bio: "Ortiz & Bennett, Madrid. Antiquities and Old Master works on paper, third generation.",
    location: "Madrid, Spain",
    fundsCents: usd(80_000),
    sellerVerified: true,
    ratingAvg: 471,
    ratingCount: 96,
  },
  {
    key: "cassandra",
    email: "cassandra.lieu@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Cassandra Lieu",
    handle: "cassandralieu",
    role: "seller",
    bio: "Private dealer. Signed period jewellery, with a weakness for Cartier London.",
    location: "Hong Kong",
    fundsCents: usd(120_000),
    sellerVerified: true,
    ratingAvg: 493,
    ratingCount: 148,
  },
  {
    key: "henrik",
    email: "henrik.sorensen@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Henrik Sørensen",
    handle: "sorensendesign",
    role: "seller",
    bio: "Copenhagen. Danish and Franco-Italian design, sourced from the families who first bought it.",
    location: "Copenhagen, Denmark",
    fundsCents: usd(60_000),
    sellerVerified: true,
    ratingAvg: 468,
    ratingCount: 74,
  },

  /* -- The room --------------------------------------------------------- */
  {
    key: "priya",
    email: "priya.raghunathan@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Priya Raghunathan",
    handle: "praghu",
    role: "bidder",
    bio: "Building a tight collection of twelve objects. Currently at nine.",
    location: "Mumbai, India",
    fundsCents: usd(500_000),
    ratingAvg: 495,
    ratingCount: 52,
  },
  {
    key: "gustav",
    email: "gustav.lindqvist@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Gustav Lindqvist",
    handle: "glindqvist",
    role: "bidder",
    bio: "Wine, whisky, and the paperwork that proves where they have been.",
    location: "Stockholm, Sweden",
    fundsCents: usd(480_000),
    ratingAvg: 476,
    ratingCount: 88,
  },
  {
    key: "nadia",
    email: "nadia.kirillova@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Nadia Kirillova",
    handle: "nkirillova",
    role: "bidder",
    bio: "Geneva-based. Watches only, and only in the metal they left the factory in.",
    location: "Geneva, Switzerland",
    fundsCents: usd(310_000),
    ratingAvg: 489,
    ratingCount: 119,
  },
  {
    key: "meiling",
    email: "meiling.chow@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Mei-Ling Chow",
    handle: "mlchow",
    role: "bidder",
    bio: "Architect. Buys chairs she intends to sit in.",
    location: "Singapore",
    fundsCents: usd(260_000),
    ratingAvg: 484,
    ratingCount: 41,
  },
  {
    key: "thomas",
    email: "thomas.achebe@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Thomas Achebe",
    handle: "tachebe",
    role: "bidder",
    bio: "Reads the condition report twice and the estimate once.",
    location: "London, United Kingdom",
    fundsCents: usd(190_000),
    ratingAvg: 472,
    ratingCount: 63,
  },
  {
    key: "dario",
    email: "dario.fontana@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Dario Fontana",
    handle: "dfontana",
    role: "bidder",
    bio: "Milan. Post-war Italian glass, and anything Scarpa touched.",
    location: "Milan, Italy",
    fundsCents: usd(95_000),
    ratingAvg: 466,
    ratingCount: 29,
  },
  {
    key: "eleanor",
    email: "eleanor.whitbourne@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Eleanor Whitbourne",
    handle: "ewhitbourne",
    role: "bidder",
    bio: "First editions and association copies. Small budget, long memory.",
    location: "Boston, MA",
    fundsCents: usd(18_500),
    ratingAvg: 458,
    ratingCount: 17,
  },
  {
    key: "yusuf",
    email: "yusuf.demir@auctioneer.dev",
    password: PRIVATE_SEED_PASSWORD,
    name: "Yusuf Demir",
    handle: "ydemir",
    role: "bidder",
    bio: "Istanbul. Near Eastern bronzes and Greek pottery; bids by telephone when he can help it.",
    location: "Istanbul, Türkiye",
    fundsCents: usd(145_000),
    ratingAvg: 479,
    ratingCount: 55,
  },
];

/* -------------------------------------------------------------------------- */
/* 4. The catalogue                                                            */
/* -------------------------------------------------------------------------- */

type LotStatus = "live" | "scheduled" | "sold" | "passed";

interface LotSpec {
  title: string;
  category: CategoryKey;
  seller: string;
  status: LotStatus;
  condition: (typeof t.conditionEnum.enumValues)[number];
  description: string;
  provenance: string;
  startCents: number;
  /** Null = sells to the highest bidder whatever it makes. */
  reserveCents: number | null;
  buyNowCents: number | null;
  buyersPremiumBps?: number;
  /** How many `placeBid` calls to drive. 0 leaves the lot untouched. */
  rounds: number;
  /** Roughly where the bidding should finish, as a multiple of the start. */
  top: number;
  /** Live lots only: how long until the hammer. */
  endsInMs?: number;
  /** Scheduled lots only: how long until bidding opens. */
  startsInMs?: number;
  /** Sale lots run under the auctioneer in real time rather than on a clock. */
  type?: "timed" | "live";
  /** Position in the evening sale, if it is in one. */
  saleLot?: number;
  /**
   * Persona who gets the last word on this lot — the standing leader if it is
   * still open, the buyer if it is not. Used sparingly, and only to guarantee
   * the demo account has a lot it is winning, a lot it has lost, and an order,
   * rather than a dashboard of near misses.
   */
  closingBidder?: string;

  /**
   * Attribution, present only on lots whose record came from an open-access
   * collection. Null on the written entries: claiming a museum stands behind
   * a lot it has never seen would be worse than claiming nothing.
   */
  sourceName?: string;
  sourceUrl?: string;
  sourceLicense?: string;
  /** Museum plate URLs to try before falling back to generated artwork. */
  imageUrls?: string[];
}

/**
 * Thirty lots, written by hand.
 *
 * These are the catalogue's skeleton rather than its flesh. `buildCatalogue`
 * keeps every number and every timestamp below — the spread of live, scheduled,
 * sold and passed lots, the three closing inside ten minutes that exercise the
 * countdown and the anti-snipe rule, the seven-lot evening sale, the range from
 * $100 to $2,000,000 — and swaps only the *identity* of each lot for a real
 * object from a museum's open-access record. What survives untouched is the
 * shape of the demo; what changes is whose watch it is.
 *
 * Two departments keep their written entries permanently, because no free
 * open-access source publishes motor cars or wine. Every entry here is also
 * the offline fallback: if the museums are unreachable, this array alone fills
 * a complete thirty-lot catalogue.
 *
 * The copy matters more than it looks like it should: a catalogue of
 * "Test Lot 4" makes every downstream layout decision — line lengths, card
 * heights, truncation points — untestable.
 */
const BUILT_IN_LOTS: LotSpec[] = [
  /* ===================== LIVE — the evening sale ======================== */
  {
    title:
      "A Rolex Cosmograph Daytona Reference 6239 with 'Exotic' Dial, Circa 1968",
    category: "timepieces",
    seller: "marcus",
    status: "live",
    condition: "excellent",
    type: "live",
    saleLot: 1,
    endsInMs: 2 * HOUR + 40 * MINUTE,
    description: para(
      "Stainless steel manual-winding chronograph wristwatch, 37mm, with black outer track and the three-block Art Deco registers collectors have called the 'exotic' dial since the 1980s. Screw-down pushers, tachymetre bezel graduated to 200 units, calibre 722-1 running at 18,000 vibrations per hour.",
      "The dial is original and unrestored, with even tropical warming to the sub-register printing and no retouching under long-wave ultraviolet. The case retains strong chamfers between the lugs and measures 12.1mm across the caseback, consistent with a watch that has been polished once, lightly, in fifty-seven years. Movement running on the timing machine at +3 seconds a day in five positions.",
      "Accompanied by a Rolex Extract from the Archives confirming production in 1968 and delivery to a retailer in Turin, together with a period-correct riveted Oyster bracelet stamped 7205.",
    ),
    provenance:
      "Acquired new in Turin, 1969; thence by descent to the present owner.",
    startCents: usd(210_000),
    reserveCents: usd(240_000),
    buyNowCents: null,
    rounds: 11,
    top: 1.62,
  },
  {
    title:
      "An Audemars Piguet Royal Oak 'Jumbo' Reference 5402, A-Series, 1973",
    category: "timepieces",
    seller: "marcus",
    status: "live",
    condition: "excellent",
    type: "live",
    saleLot: 2,
    endsInMs: 3 * HOUR + 10 * MINUTE,
    description: para(
      "Stainless steel automatic wristwatch with integrated bracelet, 39mm, from the first series of 2,000 examples produced from 1972. Calibre 2121, 2.45mm thick, visible date at three o'clock, and the tapisserie dial in the deep petrol blue that the first series alone achieved.",
      "The octagonal bezel retains its factory brushing and all eight white gold hexagonal screws are correctly aligned. Case number falls within the A-series range and is legible without ambiguity. The bracelet has stretched by roughly one link's worth over half a century, which is normal and correctable, and is offered as found.",
      "Gérald Genta drew this watch overnight in 1970 and priced it above a gold Patek, which the trade thought was a joke. It is the reason every luxury sports watch since has an integrated bracelet.",
    ),
    provenance:
      "Purchased from Audemars Piguet's Geneva agent, 1974; private collection, Zurich, from 1998.",
    startCents: usd(96_000),
    reserveCents: usd(105_000),
    buyNowCents: null,
    rounds: 9,
    top: 1.55,
  },
  {
    title: "Ines Malraux (b. 1934), 'Vertical Ochre XI', 1971",
    category: "fine-art",
    seller: "rafael",
    status: "live",
    condition: "excellent",
    type: "live",
    saleLot: 3,
    endsInMs: 5 * HOUR,
    description: para(
      "Acrylic on unprimed cotton duck, 213 by 168cm. Signed, titled and dated to the reverse of the turnover edge. Executed in Malraux's Marseille studio during the summer she stopped using a brush entirely.",
      "The paint is poured and coaxed rather than applied, and it has stained into the weave so that the picture reads as dyed cloth from three metres and as painting from one. The ochre field is interrupted by a single vertical of raw canvas — the artist's 'breathing line' — which appears in only eleven works of the series.",
      "Condition is stable and unlined, with no evidence of retouching under ultraviolet examination. Minor cockling along the upper stretcher bar consistent with the artist's method. Offered unframed, as intended.",
    ),
    provenance:
      "Galerie Saint-Ferréol, Marseille (acquired directly from the artist, 1972); private collection, Barcelona.",
    startCents: usd(38_000),
    reserveCents: usd(42_000),
    buyNowCents: usd(120_000),
    rounds: 8,
    top: 1.7,
    closingBidder: "ava",
  },
  {
    title:
      "A Burmese Ruby and Diamond Ring by Van Cleef & Arpels, Circa 1958",
    category: "jewellery-gems",
    seller: "cassandra",
    status: "live",
    condition: "mint",
    type: "live",
    saleLot: 4,
    endsInMs: 7 * HOUR + 20 * MINUTE,
    description: para(
      "Set with a cushion-cut ruby weighing 4.11 carats within a double surround of round and baguette-cut diamonds totalling approximately 2.30 carats, mounted in platinum. Signed Van Cleef & Arpels and numbered, French assay marks.",
      "Accompanied by SSEF report no. 118472 stating Burma (Myanmar) origin with no indications of heating — the combination that separates a fine ruby from a very expensive red stone. The colour is the saturated, slightly purplish red the trade still calls pigeon's blood, and it holds under both daylight and incandescent light rather than closing up.",
      "The mount is crisp and unworn, with original claw tips and no evidence of resizing. Ring size 53, adjustable.",
    ),
    provenance:
      "Van Cleef & Arpels, Place Vendôme, 1958; by descent within a Lebanese family until 2019.",
    startCents: usd(145_000),
    reserveCents: usd(165_000),
    buyNowCents: null,
    rounds: 10,
    top: 1.48,
  },
  {
    title: "A 1963 Aston Martin DB4 Series V Vantage, Chassis DB4/1042/R",
    category: "automobilia",
    seller: "marcus",
    status: "live",
    condition: "restoration",
    type: "live",
    saleLot: 5,
    endsInMs: 26 * HOUR,
    description: para(
      "Right-hand drive, finished in Dubonnet Rosso over Fawn Connolly hide. Vantage specification with triple SU carburettors, 9:1 compression and the faired-in headlamps of the final DB4 series — in effect a DB5 in everything but name.",
      "Subject to a bare-metal restoration completed in 2018 by a marque specialist in Warwickshire, with the engine rebuilt to standard Vantage specification and the original numbers-matching block retained and refitted. Invoices totalling in excess of £310,000 accompany the car, along with the Aston Martin Heritage Trust certificate confirming original colour scheme and delivery date.",
      "Approximately 1,400 miles covered since completion, largely shakedown and two continental tours. Presented with a fitted tool roll, jack, and the original buff logbook naming the first owner.",
    ),
    provenance:
      "Supplied new by Brooklands of Bond Street, February 1963; four owners from new, the present since 2016.",
    startCents: usd(1_100_000),
    reserveCents: usd(1_250_000),
    buyNowCents: null,
    buyersPremiumBps: 1200,
    rounds: 7,
    top: 1.26,
  },
  {
    title:
      "An Attic Black-Figure Neck Amphora, Manner of the Antimenes Painter, Circa 520 BC",
    category: "antiquities",
    seller: "rafael",
    status: "live",
    condition: "good",
    type: "live",
    saleLot: 6,
    endsInMs: 11 * HOUR,
    description: para(
      "Terracotta, height 41.2cm. The obverse with Herakles wrestling the Nemean lion between two onlookers, the reverse with a departing warrior flanked by attendants, palmette-and-lotus chain below the neck, rays above the foot.",
      "The figures are drawn with the sure, economical incision associated with the Antimenes Painter's circle: note the double contour at the lion's shoulder and the fastidious treatment of Herakles' beard. Added red survives on the lion's mane and on the warrior's crest; added white is largely lost, as is usual.",
      "Reassembled from large fragments with restoration to the neck and one handle, and localised infill along two body joins, all visible under ultraviolet light and disclosed in the condition report. The foot and both figural fields are substantially intact.",
    ),
    provenance:
      "Collection of Dr. Ernst Halberstadt, Munich, acquired before 1965; Ortiz & Bennett, Madrid, 2011.",
    startCents: usd(62_000),
    reserveCents: usd(70_000),
    buyNowCents: usd(210_000),
    rounds: 9,
    top: 1.44,
  },
  {
    title:
      "A Jean Prouvé 'Standard' Chair, Ateliers Jean Prouvé, Circa 1950",
    category: "modern-design",
    seller: "henrik",
    status: "live",
    condition: "good",
    type: "live",
    saleLot: 7,
    endsInMs: 46 * HOUR,
    description: para(
      "Bent sheet steel, oak plywood seat and back, with the original black enamel to the frame. Height 82cm, width 41cm, depth 50cm.",
      "Prouvé's insight was structural rather than stylistic: a seated person loads the rear legs far more than the front, so the rear legs became hollow steel tubes of triangular section while the front stayed as thin as a bicycle tube. The chair is a load diagram you can sit on, and it is why the Standard has been in continuous production, in one house or another, since 1934.",
      "This example retains its original enamel with honest wear to the foot ends and the front edge of the seat, and has not been repainted. The plywood is original and uncracked; one seat fixing has been replaced with a period-correct screw.",
    ),
    provenance:
      "Institutional commission, Lycée Fabert, Metz; deaccessioned 1998; private collection, Copenhagen.",
    startCents: usd(6_500),
    reserveCents: null,
    buyNowCents: usd(24_000),
    rounds: 12,
    top: 1.9,
  },

  /* ============ LIVE — closing shortly, timed with anti-snipe =========== */
  {
    title:
      "A George Nakashima Conoid Bench in American Black Walnut, New Hope, 1972",
    category: "modern-design",
    seller: "henrik",
    status: "live",
    condition: "excellent",
    endsInMs: 6 * MINUTE,
    description: para(
      "American black walnut with hickory spindles and a single free-edge plank seat retaining two rosewood butterfly keys. Length 183cm, depth 43cm, height 79cm. Signed in pencil to the underside with the client's name, as was Nakashima's practice.",
      "The board was chosen for its fissure, not in spite of it: the butterfly keys are placed where the timber wanted to split and are cut across the grain to arrest it. Nakashima described this as giving the tree a second life, and priced the flaw as a feature four decades before anyone else did.",
      "Excellent original condition with a warm oiled surface, light surface scratching consistent with domestic use, and no structural movement in the spindles.",
    ),
    provenance:
      "Commissioned directly from the workshop, New Hope, Pennsylvania, 1972; by descent.",
    startCents: usd(22_000),
    reserveCents: usd(26_000),
    buyNowCents: null,
    rounds: 13,
    top: 1.72,
    closingBidder: "ava",
  },
  {
    title:
      "Woolf, Virginia. A Room of One's Own. London: Hogarth Press, 1929. First edition, signed",
    category: "rare-books",
    seller: "rafael",
    status: "live",
    condition: "good",
    endsInMs: 8 * MINUTE,
    description: para(
      "Octavo. Original blue cloth lettered in gilt, in the dust jacket designed by Vanessa Bell. One of 3,040 copies of the first English edition, signed by the author on the front free endpaper.",
      "The jacket is present and unrestored, with the usual toning to the spine panel, a shallow chip at the head, and two closed tears to the lower edge — remarkable survival for a Hogarth Press jacket that was never intended to outlive the season.",
      "Internally clean and unmarked but for a contemporary ownership signature at the head of the half-title. A signed copy of the book that gave English a phrase it has not stopped using.",
    ),
    provenance:
      "From the library of a Bloomsbury correspondent; private collection, London, since 1974.",
    startCents: usd(11_500),
    reserveCents: null,
    buyNowCents: null,
    rounds: 10,
    top: 1.68,
  },
  {
    title:
      "The Macallan 1926, 60 Year Old, Fine and Rare, One Bottle",
    category: "wine-spirits",
    seller: "marcus",
    status: "live",
    condition: "mint",
    endsInMs: 9 * MINUTE,
    description: para(
      "Distilled 1926, bottled 1986 after sixty years in a single sherry-seasoned oak cask. 75cl, 42.6% alcohol by volume. From cask 263, of which only forty bottles were ever filled.",
      "Level and seal are excellent, the capsule intact, and the label crisp with no fading or foxing. Stored horizontally in a temperature-controlled cellar since 1994 and inspected under bond in March.",
      "Cask 263 has become the reference point for the entire category, and the arithmetic is simple: forty bottles, some drunk, some lost, and a market that discovers a new record every time one surfaces.",
    ),
    provenance:
      "Purchased from a European private cellar, 1994; held under bond in Edinburgh since acquisition.",
    startCents: usd(1_600_000),
    reserveCents: usd(1_650_000),
    buyNowCents: null,
    buyersPremiumBps: 1500,
    rounds: 5,
    top: 1.14,
  },

  /* ========================= SCHEDULED ================================== */
  {
    title:
      "A Patek Philippe Reference 2499 Perpetual Calendar Chronograph in Pink Gold, Second Series, Circa 1954",
    category: "timepieces",
    seller: "marcus",
    status: "scheduled",
    condition: "excellent",
    startsInMs: 4 * DAY + 6 * HOUR,
    description: para(
      "18-carat pink gold perpetual calendar chronograph wristwatch with moon phases, 37.5mm, applied Arabic numerals and square chronograph pushers — the second-series configuration, of which fewer than fifty are recorded in pink gold.",
      "Calibre 13''' based on a Valjoux ébauche and finished to Patek's own standard, with a Geneva Seal. The dial is original with an even, warm patina to the luminous and no restoration to the printing; the moon-phase disc is the correct early type with a single star to either side.",
      "The case retains its hallmarks in full and the lug chamfers are unmolested. The 2499 sits at the exact intersection of the two complications the twentieth century cared most about, and pink gold examples of the second series appear at auction perhaps twice in a decade.",
      "Accompanied by a Patek Philippe Extract from the Archives confirming manufacture in 1954 and sale in 1955, together with a later Certificate of Origin.",
    ),
    provenance:
      "Sold by Patek Philippe's Milanese agent, 1955; single family ownership until 2021.",
    startCents: usd(2_000_000),
    reserveCents: usd(2_400_000),
    buyNowCents: null,
    buyersPremiumBps: 1200,
    rounds: 0,
    top: 1,
  },
  {
    title: "Yuki Onodera-Bell (b. 1979), 'Snowline Diptych', 2016",
    category: "fine-art",
    seller: "rafael",
    status: "scheduled",
    condition: "mint",
    startsInMs: 2 * DAY + 3 * HOUR,
    description: para(
      "Pigment, marble dust and rabbit-skin gesso on birch panel, in two parts, each 120 by 90cm. Signed and dated to the reverse of the right-hand panel.",
      "Onodera-Bell builds up between fourteen and twenty ground layers and then abrades back through them with pumice, so that the horizon in this work is not painted but excavated. Seen from an angle the surface is closer to a stone floor than to a picture.",
      "In pristine condition, having been exhibited once and stored flat since. Supplied with the artist's hanging system and installation notes.",
    ),
    provenance:
      "Acquired directly from the artist's studio, Kyoto, 2017.",
    startCents: usd(46_000),
    reserveCents: usd(52_000),
    buyNowCents: usd(140_000),
    rounds: 0,
    top: 1,
  },
  {
    title:
      "A Natural Pearl and Diamond Devant-de-Corsage, Circa 1900",
    category: "jewellery-gems",
    seller: "cassandra",
    status: "scheduled",
    condition: "excellent",
    startsInMs: 5 * HOUR + 30 * MINUTE,
    description: para(
      "Designed as a garland of old European and rose-cut diamonds suspending three drop-shaped natural pearls, the largest measuring approximately 15.8 by 12.1mm, mounted in silver-topped gold with a detachable brooch fitting.",
      "Accompanied by an SSEF report confirming all three pearls as natural saltwater with no indications of treatment. Before the cultured pearl arrived in the 1920s, a jewel like this represented a decade of dredging; the market has never fully forgotten that.",
      "The mount is in fine original condition with a later safety catch, sensibly fitted. The piece may be worn as a corsage ornament, divided into two brooches, or hung as a pendant using the original fittings, all of which are present in the fitted case.",
    ),
    provenance:
      "Almost certainly Paris, circa 1900; European private collection since at least 1948.",
    startCents: usd(88_000),
    reserveCents: usd(96_000),
    buyNowCents: null,
    rounds: 0,
    top: 1,
  },
  {
    title:
      "An Egyptian Faience Ushabti for the Overseer Padihorresnet, 26th Dynasty, Circa 600 BC",
    category: "antiquities",
    seller: "rafael",
    status: "scheduled",
    condition: "good",
    startsInMs: 8 * DAY,
    description: para(
      "Pale blue-green glazed faience, height 18.4cm, mummiform, wearing a tripartite wig and plaited beard, holding hoe and pick with a seed bag over the left shoulder, the back pillar and eight horizontal registers inscribed with Chapter Six of the Book of the Dead naming the owner.",
      "The glaze is unusually well preserved with strong colour in the recesses of the inscription, which is crisply moulded and fully legible. Minor abrasion to the tip of the beard and a stable firing crack to the reverse of the base.",
      "Ushabtis were the servants you took with you: when the gods called your name to work the fields of the afterlife, the figure answered on your behalf. A well-provisioned tomb held one for every day of the year, plus overseers.",
    ),
    provenance:
      "Collection of Sir Alan Fenwick, acquired in Cairo before 1934; by descent, and thence privately in Spain.",
    startCents: usd(4_800),
    reserveCents: null,
    buyNowCents: usd(16_000),
    rounds: 0,
    top: 1,
  },
  {
    title:
      "A Pair of Poul Kjærholm PK22 Lounge Chairs, E. Kold Christensen, 1957",
    category: "modern-design",
    seller: "henrik",
    status: "scheduled",
    condition: "excellent",
    startsInMs: 20 * HOUR,
    description: para(
      "Matte-chromed spring steel frames with original wickerwork seats and backs, each stamped with the E. Kold Christensen logo to the frame. Height 71cm, width 63cm, depth 63cm.",
      "Early production examples with the correct flat-bar frame and the slightly warmer, less uniform wicker of the first decade. Kjærholm trained as a cabinetmaker and then spent his career refusing to use wood for structure; the PK22 is the clearest statement of that argument.",
      "Both chairs in excellent original condition with light patination to the steel and no breaks or repairs to the wickerwork. Sold as a pair and not to be divided.",
    ),
    provenance:
      "Purchased from Illums Bolighus, Copenhagen, 1961; single ownership until 2022.",
    startCents: usd(14_000),
    reserveCents: usd(17_500),
    buyNowCents: usd(48_000),
    rounds: 0,
    top: 1,
  },
  {
    title:
      "An Illuminated Book of Hours on Vellum, Use of Rouen, Circa 1470",
    category: "rare-books",
    seller: "rafael",
    status: "scheduled",
    condition: "good",
    startsInMs: 3 * DAY + 9 * HOUR,
    description: para(
      "Manuscript in Latin and French on vellum, 168 leaves, 172 by 122mm, written in a fine bâtarde hand in fifteen long lines, with eleven large miniatures and forty-one historiated initials in liquid gold and colours.",
      "The miniatures are the work of an artist close to the Master of the Échevinage de Rouen, with the deep lapis skies and gilded diapered grounds characteristic of the Rouen workshops in the third quarter of the century. The calendar is Rouen use throughout, and the litany names St. Romanus in first position.",
      "Bound in eighteenth-century French red morocco, gilt, with the arms of a Norman family to both covers; joints rubbed and restored at the head of the spine. Two leaves with minor cropping to the outer margin, one miniature with light flaking to the blue of the sky. Collated complete.",
    ),
    provenance:
      "Norman private library, arms to binding; Sotheby's, London, 1971, lot 42; Ortiz & Bennett, Madrid.",
    startCents: usd(64_000),
    reserveCents: usd(72_000),
    buyNowCents: null,
    rounds: 0,
    top: 1,
  },
  {
    title: "Krug, Clos du Mesnil 1995, One Methuselah",
    category: "wine-spirits",
    seller: "marcus",
    status: "scheduled",
    condition: "mint",
    startsInMs: 30 * HOUR,
    description: para(
      "One methuselah (6 litres), in original wooden case, from the walled 1.85-hectare Chardonnay parcel in Le Mesnil-sur-Oger that Krug has bottled separately since 1979.",
      "1995 is the vintage that persuaded the doubters: taut, saline and utterly unhurried, with the chalk of the site reading straight through the wine. Large formats age more slowly still, and a methuselah of Clos du Mesnil is effectively a wine that has not yet begun.",
      "Level and colour excellent, capsule and labels pristine, case intact with its original documentation. Stored in Krug's own conditions until 2011 and under professional bond since.",
    ),
    provenance:
      "Ex-cellar, Krug, Reims; private purchase 2011; under bond, London, since.",
    startCents: usd(38_000),
    reserveCents: usd(44_000),
    buyNowCents: usd(96_000),
    rounds: 0,
    top: 1,
  },
  {
    title:
      "A Bugatti Type 35 Radiator Badge with Original Works Toolkit, Circa 1926",
    category: "automobilia",
    seller: "marcus",
    status: "scheduled",
    condition: "fair",
    startsInMs: 12 * HOUR,
    description: para(
      "The enamelled radiator badge of oval form with the red Bugatti script on a white ground, together with a canvas works toolroll containing eleven original Bugatti-stamped spanners, a plug spanner and a grease gun.",
      "The badge retains approximately 85 percent of its original enamel with losses at the lower edge and a stable hairline through the upper field. The toolroll is complete to the pattern illustrated in the 1926 works handbook, with honest oil staining and the original leather ties intact.",
      "Offered without reserve. Ettore Bugatti had the toolkits made to the same drawings as the cars, which is precisely the sort of decision that explains both the marque and its accounts.",
    ),
    provenance:
      "From the estate of a French Bugattiste; acquired by the present owner at Rétromobile, 2009.",
    startCents: usd(100),
    reserveCents: null,
    buyNowCents: usd(9_500),
    rounds: 0,
    top: 1,
  },

  /* ============================ SOLD ==================================== */
  {
    title:
      "A. Lange & Söhne Datograph Reference 403.035 in Platinum, Circa 2003",
    category: "timepieces",
    seller: "marcus",
    status: "sold",
    condition: "mint",
    description: para(
      "Platinum flyback chronograph wristwatch with outsize date, 39mm, black dial with applied white gold Roman numerals. Calibre L951.1, hand-finished with a hand-engraved balance cock and 405 components, visible through a sapphire caseback.",
      "The Datograph is the watch that made Switzerland take Glashütte seriously again. Philippe Dufour has said in print that it is the finest chronograph movement in series production; the argument since has been about whether that is generous or merely accurate.",
      "Unpolished, with sharp case flanks and crisp lug bevels. Complete with box, certificate, and the original sales receipt from the Dresden boutique.",
    ),
    provenance:
      "Purchased new, A. Lange & Söhne boutique, Dresden, 2003; single ownership from new.",
    startCents: usd(62_000),
    reserveCents: usd(70_000),
    buyNowCents: null,
    rounds: 11,
    top: 1.58,
  },
  {
    title:
      "Tobias Reinhardt (1901–1978), 'Nocturne, Harbour at Trieste', 1948",
    category: "fine-art",
    seller: "rafael",
    status: "sold",
    condition: "good",
    description: para(
      "Oil on panel, 54 by 73cm. Signed lower right and dated; titled on an old label to the reverse in the artist's hand.",
      "Painted in the two years Reinhardt spent on the Adriatic after leaving Vienna, when his palette collapsed to four pigments and his pictures got very much better. The harbour is described almost entirely in the reserved ground, with the paint doing nothing but hold the lights.",
      "Cradled panel with an old stable vertical check to the upper left, and scattered retouching along the sky visible under ultraviolet. Cleaned and revarnished in 2014.",
    ),
    provenance:
      "The artist's estate; Galerie Wesselmann, Vienna, 1981; private collection, Madrid.",
    startCents: usd(26_000),
    reserveCents: usd(28_000),
    buyNowCents: null,
    rounds: 8,
    top: 1.52,
  },
  {
    title:
      "An Art Deco Emerald and Diamond Bracelet by Cartier, Paris, 1927",
    category: "jewellery-gems",
    seller: "cassandra",
    status: "sold",
    condition: "excellent",
    description: para(
      "Designed as a geometric band of calibré-cut emeralds and old European, baguette and single-cut diamonds in a stepped ziggurat pattern, mounted in platinum. Signed Cartier Paris and numbered, French assay and maker's marks. Length 18.2cm.",
      "The calibré cutting is exceptional even by Cartier's standards of the period: each emerald is shaped individually to its setting so that the green reads as an unbroken line rather than a row of stones. This is expensive to do and impossible to fake convincingly.",
      "Excellent condition throughout with a secure box clasp and two figure-of-eight safety fittings. Accompanied by a Cartier archive letter confirming the date of manufacture.",
    ),
    provenance:
      "Cartier, 13 rue de la Paix, 1927; thence by descent until 2018; Cassandra Lieu, Hong Kong.",
    startCents: usd(96_000),
    reserveCents: usd(110_000),
    buyNowCents: null,
    rounds: 12,
    top: 1.46,
  },
  {
    title:
      "A 1972 Porsche 911 2.4 S Coupé in Signal Orange, Matching Numbers",
    category: "automobilia",
    seller: "marcus",
    status: "sold",
    condition: "excellent",
    description: para(
      "Left-hand drive, finished in Signal Orange over black leatherette, with the 190bhp 2,341cc flat-six, mechanical fuel injection and the five-speed 915 gearbox. The last of the long-bonnet cars and, for most people who have driven both, the best of them.",
      "Restored in 2016 with the original engine and gearbox retained and rebuilt, documented by a Porsche Certificate of Authenticity confirming colour, options and delivery date. Approximately 4,900 miles since completion.",
      "Presented with its original tool roll, jack, owner's manual and service book, together with a full photographic record of the restoration and invoices in excess of €180,000.",
    ),
    provenance:
      "Delivered new in Stuttgart, March 1972; two German owners; UK-registered since 2017.",
    startCents: usd(240_000),
    reserveCents: usd(260_000),
    buyNowCents: null,
    buyersPremiumBps: 1200,
    rounds: 9,
    top: 1.34,
  },
  {
    title:
      "A Roman Marble Portrait Head of a Youth, Julio-Claudian, 1st Century AD",
    category: "antiquities",
    seller: "rafael",
    status: "sold",
    condition: "restoration",
    description: para(
      "Fine-grained white marble, height 26cm, the head turned slightly to its left, with short comma-shaped locks combed forward over the brow in the Julio-Claudian manner and softly modelled cheeks indicating a sitter in his late teens.",
      "The surface retains a warm honey-coloured burial patina across the proscribed areas with encrustation in the recesses of the hair. Sensitively cleaned in the 1960s without the aggressive polishing common to that decade.",
      "Losses to the nose and to the lower edge of the right ear; the neck cut for insertion into a draped statue body, as normal. Mounted on a modern black marble socle, easily removed.",
    ),
    provenance:
      "Collection of Comte Henri de Vaugirard, Paris, before 1939; European private collection, 1968.",
    startCents: usd(58_000),
    reserveCents: usd(62_000),
    buyNowCents: null,
    rounds: 7,
    top: 1.42,
  },
  {
    title:
      "A Carlo Scarpa 'Battuto' Glass Vase for Venini, Murano, Circa 1940",
    category: "modern-design",
    seller: "henrik",
    status: "sold",
    condition: "excellent",
    description: para(
      "Blown glass of cylindrical form in smoky grey-green, the entire surface worked with the battuto technique, acid-etched Venini Murano ITALIA three-line mark to the underside. Height 21.5cm.",
      "Battuto — 'beaten' — is cold work: the cooled vessel is ground with a wheel into hundreds of shallow facets so that the surface reads like hammered metal and the light is scattered rather than transmitted. Scarpa spent thirteen years at Venini finding out what glass would tolerate, and this is the technique he is remembered for.",
      "Excellent condition with no chips, cracks or bruises, and only minor wear to the base consistent with age.",
    ),
    provenance:
      "Private collection, Venice; Danish private collection since 1994.",
    startCents: usd(18_000),
    reserveCents: usd(20_000),
    buyNowCents: null,
    rounds: 9,
    top: 1.62,
    closingBidder: "ava",
  },
  {
    title:
      "Newton, Isaac. Philosophiæ Naturalis Principia Mathematica. London, 1687. First edition",
    category: "rare-books",
    seller: "rafael",
    status: "sold",
    condition: "good",
    description: para(
      "Quarto. The continental issue, with the Streater imprint and the title-page bearing the imprimatur of Samuel Pepys as President of the Royal Society. Woodcut diagrams throughout, folding plate of the comet of 1680 present and unrepaired.",
      "The Royal Society had spent its funds on a history of fishes and could not pay for this book; Edmond Halley financed it himself and corrected the proofs. What he bought for his money was the first mathematical description of a universe that behaves the same everywhere.",
      "Bound in contemporary calf, rebacked in the nineteenth century preserving the original spine label, corners restored. Internally a good, wide-margined copy with light browning to quires C and D and an early ownership inscription to the title.",
      "Collated complete including the final leaf of errata.",
    ),
    provenance:
      "Ownership inscription of Thomas Aylmer, 1698; Continental institutional library, deaccessioned 1962; private collection.",
    startCents: usd(900_000),
    reserveCents: usd(950_000),
    buyNowCents: null,
    buyersPremiumBps: 1200,
    rounds: 6,
    top: 1.28,
  },
  {
    title:
      "Domaine de la Romanée-Conti, La Tâche 1990, Six Bottles in Original Case",
    category: "wine-spirits",
    seller: "marcus",
    status: "sold",
    condition: "mint",
    description: para(
      "Six bottles (6 x 75cl) in the original wooden case, capsules and labels pristine, all levels into neck.",
      "1990 is the vintage against which the domaine's own staff measure the decade, and La Tâche — the monopole that DRC has held whole since 1933 — is the wine in the range that gives everything away at once instead of making you wait.",
      "Purchased on release through the domaine's UK allocation and never moved from professional storage. Sold in bond, duty and VAT payable by the buyer if removed for consumption in the United Kingdom.",
    ),
    provenance:
      "Corney & Barrow allocation, 1992; single ownership; under bond, Wiltshire, since release.",
    startCents: usd(72_000),
    reserveCents: usd(80_000),
    buyNowCents: null,
    rounds: 10,
    top: 1.44,
  },

  /* =========================== PASSED =================================== */
  {
    title: "A Cartier Tank Cintrée in 18-Carat Yellow Gold, London, 1969",
    category: "timepieces",
    seller: "cassandra",
    status: "passed",
    condition: "fair",
    description: para(
      "18-carat yellow gold curved rectangular wristwatch, 46 by 23mm, with silvered dial, Roman numerals and blued steel sword hands, on a later Cartier deployant buckle. London hallmarks for 1969.",
      "The Cintrée is the Tank bent to the wrist, and the curve is the whole point: it is why the case is difficult to make and why the model has never been in continuous production.",
      "The dial has been restored at some point in the last thirty years, competently but detectably, and the case shows softening to the edges from repeated polishing. Offered accordingly and described frankly; the reserve reflected an original dial that this example no longer has.",
    ),
    provenance:
      "Cartier London, 1969; private collection, Hong Kong, from 1996.",
    startCents: usd(28_000),
    reserveCents: usd(95_000),
    buyNowCents: null,
    rounds: 6,
    top: 1.45,
  },
  {
    title:
      "After Giovanni Battista Piranesi, 'Carceri d'Invenzione', Plate VII, later impression",
    category: "fine-art",
    seller: "rafael",
    status: "passed",
    condition: "fair",
    description: para(
      "Etching on laid paper, plate 545 by 410mm, sheet 605 by 455mm. A later impression from the reworked plates, printed in the nineteenth century.",
      "Piranesi's imaginary prisons are architecture that cannot be built and does not need to be: staircases that arrive nowhere, machinery with no purpose, and a sense of scale that has been borrowed by every set designer since.",
      "The impression is grey and somewhat worn, with the fine cross-hatching of the vaults substantially closed. Time staining, a repaired tear entering 40mm from the lower edge, and old mounting remains to the reverse corners.",
      "Offered as a decorative impression rather than a collector's one, and it did not find its level in the room.",
    ),
    provenance:
      "European private collection; acquired in the trade, 2007.",
    startCents: usd(1_800),
    reserveCents: usd(6_500),
    buyNowCents: null,
    rounds: 5,
    top: 1.5,
  },
  {
    title:
      "A Pair of Fancy Intense Yellow Diamond Ear Pendants, 6.02 and 5.94 carats",
    category: "jewellery-gems",
    seller: "cassandra",
    status: "passed",
    condition: "mint",
    description: para(
      "Each suspending a cushion modified brilliant-cut fancy intense yellow diamond weighing 6.02 and 5.94 carats respectively, from a surmount of round brilliant-cut diamonds, mounted in yellow gold and platinum.",
      "Accompanied by GIA reports stating Fancy Intense Yellow, natural colour origin, VS1 and VS2 clarity respectively. The stones are a close match in tone and saturation, which is the difficult part; matched pairs above five carats are perhaps a tenth as common as the singles.",
      "In pristine condition with detachable surmounts allowing the drops to be worn as studs. The lot failed to reach its reserve and is available for post-sale negotiation.",
    ),
    provenance:
      "Private collection, Geneva; offered from the estate of the original purchaser.",
    startCents: usd(180_000),
    reserveCents: usd(420_000),
    buyNowCents: null,
    rounds: 4,
    top: 1.3,
  },
  {
    title:
      "A Luristan Bronze Master-of-Animals Finial, Circa 900–700 BC",
    category: "antiquities",
    seller: "rafael",
    status: "passed",
    condition: "good",
    description: para(
      "Cast bronze, height 17.8cm, in the form of a stylised human figure grasping the necks of two rearing felines whose bodies curve down to meet a shared tubular support, the whole with a dark green patina and cuprite inclusions.",
      "Finials of this type were cast by the lost-wax process in the Zagros mountains and are usually found with a matching tubular stand; the motif of a figure mastering paired beasts travels from Mesopotamia to Greece and outlives every civilisation that used it.",
      "Casting flaws to the reverse of one feline as made, and a stable old break through the left forepaw. Mounted on a modern perspex stand.",
      "No bids were received at the reserve and the lot is unsold.",
    ),
    provenance:
      "Collection of Prof. Marcel Duchesne, Brussels, acquired before 1968; by descent.",
    startCents: usd(9_500),
    reserveCents: usd(22_000),
    buyNowCents: null,
    rounds: 0,
    top: 1,
  },
];

/* -------------------------------------------------------------------------- */
/* 5. Real objects                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Escape hatch for testing the degraded path — and for seeding on an aeroplane.
 * `SEED_OFFLINE=1 npm run db:seed` never opens a socket to a museum.
 */
const OFFLINE = process.env.SEED_OFFLINE === "1";

/**
 * How long one source lookup may take before the seed gives up on it.
 *
 * The adapters already time out individual requests, but the Met's search
 * returns thousands of object ids and walks them one at a time; when its WAF
 * starts refusing us mid-walk, every id costs a retry and the walk never
 * reaches its quota. Racing the whole task against a deadline turns "the
 * seed hangs for twenty minutes" into "that department keeps its written
 * lots". The losing promise is left to unravel on its own — it holds no
 * database handle, and the process exits when `main` is done.
 */
const SOURCE_DEADLINE_MS = 45_000;

function withDeadline<T>(label: string, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} took longer than ${SOURCE_DEADLINE_MS}ms`)), SOURCE_DEADLINE_MS).unref(),
    ),
  ]);
}

/**
 * Run one source lookup, converting any failure into an empty result.
 *
 * Every call site treats "no objects" and "the museum is down" identically,
 * which is the whole point: a seed that dies because Chicago is deploying is
 * not a seed anybody can rely on.
 */
async function attempt(label: string, load: () => Promise<SourceObject[]>): Promise<SourceObject[]> {
  if (OFFLINE) return [];
  try {
    const found = await withDeadline(label, load());
    console.log(`  · ${label.padEnd(34)} ${String(found.length).padStart(2)} object(s)`);
    return found;
  } catch (error) {
    // The adapters put the whole request URL in the message, which is three
    // hundred characters of query string per failure. Twenty-two of those is
    // not a log, it is a wall.
    const why = (error as Error).message.replace(/\?[^\s]*/, "?…");
    console.warn(`  ! ${label.padEnd(34)} unavailable — ${why}`);
    return [];
  }
}

/**
 * One query against one source, and how much of its yield a department may
 * take. The cap is what lets a department mix sources deliberately rather than
 * letting whichever one answers first fill every slot.
 */
type SourceTask = [label: string, load: () => Promise<SourceObject[]>, cap: number];

/**
 * Draw from several queries in order until a department has enough objects,
 * skipping duplicates.
 *
 * Within a single query's results, an object whose institution publishes an
 * ownership history is always taken ahead of one that does not. Provenance is
 * the field this whole exercise exists to put in front of a bidder, and the
 * search endpoints return it in no particular order.
 *
 * De-duplication is by title as well as by id: a single V&A search for
 * "glass vase" happily returns two photographs of the same pressed-glass
 * pattern, and a saleroom does not offer the same object twice in one sale.
 */
async function gather(want: number, tasks: SourceTask[]) {
  const out: SourceObject[] = [];
  const seen = new Set<string>();
  for (const [label, load, cap] of tasks) {
    if (out.length >= want) break;
    const ranked = [...(await attempt(label, load))].sort(
      (a, b) => Number(!a.provenance) - Number(!b.provenance),
    );
    let taken = 0;
    for (const object of ranked) {
      if (out.length >= want || taken >= cap) break;
      const key = object.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seen.has(object.externalId) || seen.has(key)) continue;
      seen.add(object.externalId);
      seen.add(key);
      out.push(object);
      taken++;
    }
  }
  return out;
}

/* ------------------------------ catalogue voice --------------------------- */

const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or",
  "the", "to", "with",
]);

/** Capitalise the first *letter*, so "(jar)" becomes "(Jar)" and not "(jar)". */
const upperFirstLetter = (word: string) =>
  word.replace(/(^|-)([^a-z]*)([a-z])/g, (_, sep, lead, letter) => sep + lead + letter.toUpperCase());

/** Title-case a fragment the way a catalogue heading is set. */
function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word.replace(/[^a-z]/g, "")) ? word : upperFirstLetter(word),
    )
    .join(" ");
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** End a fragment as a sentence without doubling a full stop it already has. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** Strip a trailing full stop so a fragment can be embedded in a longer one. */
const unpunctuated = (text: string) => text.trim().replace(/\.$/, "");

/** Drop the "(American, 1838–1909)" the fine-art sources append to a name. */
const bareName = (raw: string) => raw.replace(/\s*\([^)]*\)\s*$/, "").trim();

/**
 * "Jaeger, Edmond" -> "Edmond Jaeger". Museums index people by surname; a lot
 * title reads them out loud. Firms are left alone — "Elco Clocks and Watches
 * Ltd." must not become "Ltd. Elco Clocks and Watches".
 */
function personName(raw: string): string {
  const match = /^([^,()]+),\s*([^,()]+)$/.exec(raw.trim());
  if (!match) return raw.trim();
  const [, family, given] = match;
  if (/\b(ltd|inc|co|company|works|manufactory|brothers|freres|frères|&)\b\.?/i.test(given)) {
    return raw.trim();
  }
  return `${given.trim()} ${family.trim()}`;
}

/** "Charles Dickens" -> "Dickens, Charles", which is how a book lot is filed. */
function surnameFirst(raw: string): string {
  const name = bareName(raw);
  if (name.includes(",")) return name;
  const parts = name.split(/\s+/);
  if (parts.length < 2) return name;
  const family = parts.pop()!;
  return `${family}, ${parts.join(" ")}`;
}

/**
 * "Victoria and Albert Museum" is how the adapter reports it and "the Victoria
 * and Albert Museum" is how a sentence says it. The Met and the Art Institute
 * already carry their article; the V&A and Open Library do not.
 */
const institution = (name: string) => (/^the\b/i.test(name) ? name : `the ${name}`);

const isAnonymous = (name: string | null) =>
  !name || /^(unknown|unidentified|anonymous)$/i.test(name.trim());

/** "An Enamel…", "A 'Ripple' Pattern" — judged on the first letter, not the
 *  first character, because a title can open with a quotation mark. */
const indefinite = (phrase: string) => (/^[aeiou]/i.test(phrase.replace(/[^a-zA-Z]/g, "")) ? "An" : "A");

/**
 * Materials a lot title may lead with.
 *
 * Deliberately a closed list. A museum's materials field is free prose — "The
 * dial appears to be made of enamel, not porcelain", "Found, transfer printed
 * earthenware plate" — and pasting it into a heading produces things like
 * "A Not Porcelain Carriage Clock". Matching a known material against that
 * prose, rather than reproducing the prose, is the difference between a
 * catalogue and a string concatenation.
 */
const MATERIALS = [
  "platinum", "gold", "silver", "bronze", "brass", "pewter", "copper", "steel",
  "marble", "alabaster", "limestone", "terracotta", "porcelain", "faience",
  "earthenware", "stoneware", "glass", "enamel", "ivory", "jade", "amber",
  "tortoiseshell", "oak", "walnut", "mahogany", "rosewood", "ebony", "teak",
  "plywood", "leather", "silk", "aluminium",
];

/**
 * Prose that hedges is prose we cannot lift a fact out of. A record saying a
 * dial "appears to be" enamel is telling us the cataloguer was not sure, and a
 * lot heading is the wrong place to resolve their doubt for them.
 */
const HEDGED = /\b(not|no|appears?|probably|possibly|perhaps|unknown|unidentified|imitation|imitating|simulated|faux|rather than)\b/i;

/**
 * The single material a title may lead with, or null.
 *
 * Only the first clause of the materials field is considered — that is where
 * an institution puts the primary material — and only when it is unhedged and
 * the word is not already in the object's own title. "Terracotta amphora" must
 * never become "A Terracotta Terracotta Amphora", and "Ply Chair" must not
 * pick up "plywood".
 */
function leadingMaterial(medium: string | null, coreTitle: string): string | null {
  if (!medium) return null;
  const clause = medium.split(/[;,.]/)[0]?.trim() ?? "";
  if (!clause || clause.length > 60 || HEDGED.test(clause)) return null;

  const found = MATERIALS.find((m) => new RegExp(`\\b${m}\\b`, "i").test(clause));
  if (!found) return null;

  // Reject anything that would repeat, or share a stem with, a word already in
  // the title. Substring matching in both directions catches ply/plywood.
  const words = coreTitle.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.some((w) => w.length >= 3 && (w.includes(found) || found.includes(w)))) return null;

  return titleCase(found);
}

/** Titles are a fixed-width slot in every card in the app; keep them in it. */
function clamp(parts: string[], limit = 110): string {
  for (let keep = parts.length; keep > 1; keep--) {
    const line = parts.slice(0, keep).join(", ");
    if (line.length <= limit) return line;
  }
  const head = parts[0];
  return head.length <= limit ? head : `${head.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * "A Gold Brooch, 500-600" · "The Milton Brooch, 600-700" ·
 * "A Terracotta Amphora (Jar), Andokides, ca. 530 BCE".
 *
 * The museum's own object title is already catalogue-quality, so it is the
 * core and it is never rewritten — only cased, optionally led by one material,
 * and followed by maker and date. The pieces drop from the right when the line
 * runs long, so a lot always keeps the thing it is before it keeps the year it
 * was made.
 */
function objectTitle(object: SourceObject): string {
  const core = titleCase(object.title.trim());
  // A title that names itself is complete as it stands. "The Milton Brooch"
  // and "Joan's Chair" both already say what the object is called, so neither
  // takes an article in front of it, and neither takes a material either:
  // "An Oak Joan's Chair" reads as somebody else's chair.
  const named = /^(a|an|the)\s/i.test(core) || /^[A-Z][a-z]+['’]s\s/.test(core);
  // Quoted pattern and model names are the maker's own, not a description, so
  // they keep their article but not a material: "A 'Ripple' Pattern".
  const quoted = /['’"“]/.test(core.split(/\s+/)[0] ?? "");
  const material = named || quoted ? null : leadingMaterial(object.medium, core);
  const head = material ? `${material} ${core}` : core;
  const parts = [named ? head : `${indefinite(head)} ${head}`];
  if (!isAnonymous(object.maker)) parts.push(personName(bareName(object.maker!)));
  if (object.dateText) parts.push(object.dateText);
  return clamp(parts);
}

/** The house style for pictures, matching the written entries: maker, work, date. */
function artworkTitle(object: SourceObject): string {
  if (isAnonymous(object.maker)) return objectTitle(object);
  const full = object.maker!.trim();
  const parts = [full, `'${object.title.trim()}'`];
  if (object.dateText) parts.push(object.dateText);
  const line = clamp(parts);
  // Losing the artist's dates costs less than losing the year of the work.
  return line.length <= 110 ? line : clamp([bareName(full), `'${object.title.trim()}'`, object.dateText ?? ""].filter(Boolean));
}

/**
 * "Dickens, Charles. Great Expectations" — bibliographic filing order, and
 * deliberately no year.
 *
 * Open Library's `first_publish_year` is drawn from whichever edition a
 * cataloguer happened to enter, and it is often wrong: it dates A Tale of Two
 * Cities to 1800, twelve years before Dickens was born. A heading is the
 * platform speaking in its own voice, and a wrong date asserted there is a
 * misdescription. The year still appears in the note, attributed to the source
 * and described as what it actually is.
 */
function bookTitle(object: SourceObject): string {
  const line = isAnonymous(object.maker)
    ? object.title.trim()
    : `${surnameFirst(object.maker!)}. ${object.title.trim()}`;
  return line.length <= 110 ? line : `${line.slice(0, 109).trimEnd()}…`;
}

function lotTitle(object: SourceObject, department: CategoryKey): string {
  if (department === "fine-art") return artworkTitle(object);
  if (department === "rare-books") return bookTitle(object);
  return objectTitle(object);
}

/**
 * Saleroom boilerplate, one line per department.
 *
 * Deliberately says nothing about the individual object. Everything specific
 * in a note below is a field the institution published; everything general is
 * a term of sale that is true of every lot in its department.
 */
const DEPARTMENT_TERMS: Record<CategoryKey, string> = {
  timepieces:
    "Catalogued from the holding institution's record rather than from a bench examination: the movement has not been opened, timed or serviced for this sale, and is offered as found. Viewing is recommended.",
  "fine-art":
    "Dimensions are those given by the holding institution and are sight measurements unless stated. No ultraviolet or infrared examination has been carried out for this catalogue; prospective buyers are asked to satisfy themselves as to condition.",
  "jewellery-gems":
    "Metals, stones and any treatment are as described in the institutional record. No current laboratory report accompanies this lot, and weights are not warranted.",
  antiquities:
    "Offered under our antiquities terms. The description follows the holding institution's published record, and responsibility for any export or import licence rests with the buyer.",
  "modern-design":
    "Materials and dimensions follow the holding institution's record. Twentieth-century production pieces are sold as found, with the wear a working object of this age would be expected to carry.",
  "rare-books":
    "Not collated and sold not subject to return. No edition, issue or state is warranted: the record describes the work rather than any one impression of it, and the plate reproduced is the copy scanned by the source library.",
  automobilia: "",
  "wine-spirits": "",
};

/**
 * Compose a catalogue note from what the museum actually published.
 *
 * Three paragraphs: the object, the record, the terms. Nothing is invented —
 * the temptation with a thin record is to write the condition report the field
 * is missing, and a fabricated condition report on a real object is a lie with
 * a museum's name attached to it.
 */
function catalogueNote(object: SourceObject, department: CategoryKey): string {
  const paragraphs: string[] = [];

  /* 1. The object, in the order a cataloguer would take it down. */
  const physical: string[] = [];
  if (object.medium) physical.push(sentence(capitalise(object.medium)));
  if (object.dimensions) physical.push(sentence(capitalise(object.dimensions.replace(/\s+/g, " "))));
  const maker = isAnonymous(object.maker) ? null : personName(bareName(object.maker!));
  if (department === "rare-books") {
    if (maker) physical.push(`Written by ${maker}.`);
    // Reported, not asserted: see `bookTitle` on why this date is not ours.
    if (object.dateText) {
      physical.push(`${capitalise(institution(object.sourceName))} records the earliest catalogued edition of the work as ${object.dateText}, which is a cataloguing date rather than a bibliographical one and is not warranted here.`);
    }
  } else if (department === "fine-art") {
    if (maker && object.dateText) physical.push(`${maker}, ${object.dateText}.`);
    else if (maker) physical.push(`${maker}.`);
    else if (object.dateText) physical.push(`Dated ${object.dateText} in the collection record.`);
  } else {
    if (maker && object.dateText) physical.push(`Made by ${maker}, ${object.dateText}.`);
    else if (maker) physical.push(`Made by ${maker}.`);
    else if (object.dateText) physical.push(`Dated ${object.dateText} in the collection record.`);
  }
  if (physical.length === 0) physical.push(`Catalogued as ${unpunctuated(object.title)}.`);
  paragraphs.push(physical.join(" "));

  /* 2. Where the facts come from, and what the institution says about them. */
  if (object.provenance) {
    paragraphs.push(
      `${capitalise(institution(object.sourceName))} publishes an ownership history for this object, reproduced in full under Provenance below. It is given exactly as the institution records it — an unbroken chain is the one thing a catalogue note cannot manufacture, and the one thing a buyer most wants to read.`,
    );
  } else if (object.creditLine) {
    paragraphs.push(
      `No independent ownership history accompanies this lot. What ${institution(object.sourceName)} records of its own acquisition is given under Provenance below, and nothing beyond it is asserted.`,
    );
  } else {
    paragraphs.push(
      `The record for this object is published by ${institution(object.sourceName)}, which gives neither an acquisition credit nor an ownership history for it. Both are noted here as absent rather than filled in.`,
    );
  }

  /* 3. Terms, then the attribution the licence asks for. */
  const terms = DEPARTMENT_TERMS[department];
  const credit = `Catalogue data for this lot is drawn from ${institution(object.sourceName)}'s open-access collections record (${object.sourceLicense}).`;
  paragraphs.push(terms ? `${terms} ${credit}` : credit);

  return para(...paragraphs);
}

/**
 * The provenance field.
 *
 * The Art Institute is the only source that publishes a chain, and where it
 * does it goes in verbatim. Everywhere else this says so plainly. Inventing an
 * ownership history for a real object — the exact thing a forger does — would
 * make the demo teach the wrong lesson about what this field is for.
 */
function provenanceNote(object: SourceObject): string {
  if (object.provenance) return object.provenance;
  if (object.creditLine) {
    return `Not independently established for this sale. ${capitalise(institution(object.sourceName))} records its own acquisition as: ${unpunctuated(object.creditLine)}.`;
  }
  return `Not established. ${capitalise(institution(object.sourceName))} publishes the catalogue record for this object but no ownership history, and none is asserted here.`;
}

/* ------------------------------ the departments --------------------------- */

/**
 * Where each department's objects come from.
 *
 * Queries are ordered, and the later ones exist to top up a department when an
 * earlier source is thin or unreachable — which is also why fine art asks the
 * Art Institute first. It is the only source that publishes provenance, and
 * provenance is the field the whole exercise is about.
 *
 * `automobilia` and `wine-spirits` are absent on purpose: no open-access
 * collection publishes motor cars or claret, and a lot invented from nothing
 * is more honest than a lot dressed up as a museum record.
 */
const DEPARTMENT_SOURCES: Partial<Record<CategoryKey, (want: number) => SourceTask[]>> = {
  "fine-art": (want) => [
    // Ask Chicago for far more than we need and take only the three whose
    // records carry a chain of ownership. The remaining slot goes to the Met,
    // partly for a second voice in the department and partly because the Art
    // Institute's image server refuses some hosts outright — a department that
    // draws from one source alone can end up with no photography at all.
    ["AIC · painting", () => fetchAic({ query: "painting", want: want * 3 }), Math.max(1, want - 1)],
    ["Met · European Paintings", () => fetchMet({ departmentId: 11, query: "portrait", want: 3 }), 2],
    ["Met · Modern Art", () => fetchMet({ departmentId: 21, query: "painting", want: 3 }), 2],
    ["AIC · landscape", () => fetchAic({ query: "landscape oil", want: want * 2 }), want],
  ],
  antiquities: (want) => [
    ["Met · Greek and Roman", () => fetchMet({ departmentId: 13, query: "amphora", want }), want],
    ["Met · Greek and Roman (marble)", () => fetchMet({ departmentId: 13, query: "marble statue", want: 2 }), 2],
    ["Met · Egyptian", () => fetchMet({ departmentId: 10, query: "statuette", want: 3 }), 3],
    // Last resort, and still a real object: the Met's edge occasionally
    // rate-limits a seed run down to nothing, and an empty department is worse
    // than one drawn from Chicago's classical holdings.
    ["AIC · classical antiquity", () => fetchAic({ query: "Greek vase antiquity", want: 3 }), want],
  ],
  timepieces: (want) => [
    ["V&A · wristwatch", () => fetchVam({ query: "wristwatch", want: 3 }), 2],
    ["V&A · mantel clock", () => fetchVam({ query: "mantel clock", want: 2 }), 2],
    ["V&A · gold watch", () => fetchVam({ query: "gold watch", want: 3 }), 2],
    ["V&A · carriage clock", () => fetchVam({ query: "carriage clock", want }), want],
  ],
  "jewellery-gems": (want) => [
    ["V&A · brooch gold", () => fetchVam({ query: "brooch gold", want: 2 }), 2],
    ["V&A · necklace", () => fetchVam({ query: "necklace", want: 2 }), 2],
    ["V&A · ring gem", () => fetchVam({ query: "ring gem", want }), want],
  ],
  "modern-design": (want) => [
    ["V&A · chair", () => fetchVam({ query: "chair", want: 2 }), 2],
    ["V&A · glass vase", () => fetchVam({ query: "glass vase", want: 2 }), 1],
    ["V&A · silver teapot", () => fetchVam({ query: "silver teapot", want: 2 }), 2],
    ["V&A · table lamp", () => fetchVam({ query: "table lamp", want }), want],
  ],
  "rare-books": (want) => [
    ["Open Library · Dickens", () => fetchOpenLibrary({ query: "Charles Dickens first edition", want: 2 }), 1],
    ["Open Library · Austen", () => fetchOpenLibrary({ query: "Jane Austen", want: 2 }), 1],
    ["Open Library · Woolf", () => fetchOpenLibrary({ query: "Virginia Woolf", want: 2 }), want],
  ],
};

/**
 * The catalogue the seed actually writes.
 *
 * Every lot keeps its department, consignor, status, timings, opening price,
 * reserve, buy-now and bid choreography from `BUILT_IN_LOTS`; only its
 * identity — title, note, provenance, attribution and plates — is replaced
 * with a real object. Departments are filled in array order, so a source that
 * returns three objects for four slots leaves the fourth as written rather
 * than leaving a hole.
 */
async function buildCatalogue(): Promise<LotSpec[]> {
  if (OFFLINE) {
    console.warn("→ SEED_OFFLINE=1 — museum sources skipped, seeding from built-in catalogue");
    return BUILT_IN_LOTS;
  }

  console.log("→ drawing real objects from open-access museum collections");
  const pools = new Map<CategoryKey, SourceObject[]>();
  for (const [department, plan] of Object.entries(DEPARTMENT_SOURCES) as Array<
    [CategoryKey, (want: number) => SourceTask[]]
  >) {
    // Ask for exactly as many objects as the array has slots in that
    // department, so the arithmetic cannot drift from the catalogue.
    const want = BUILT_IN_LOTS.filter((lot) => lot.category === department).length;
    pools.set(department, await gather(want, plan(want)));
  }

  let sourced = 0;
  const catalogue = BUILT_IN_LOTS.map((spec) => {
    const object = pools.get(spec.category)?.shift();
    if (!object) return spec;
    sourced++;
    return {
      ...spec,
      title: lotTitle(object, spec.category),
      description: catalogueNote(object, spec.category),
      provenance: provenanceNote(object),
      sourceName: object.sourceName,
      sourceUrl: object.sourceUrl,
      sourceLicense: object.sourceLicense,
      imageUrls: object.images,
    } satisfies LotSpec;
  });

  if (sourced === 0) {
    console.warn("! museum sources unavailable — seeding from built-in catalogue");
  } else {
    console.log(`✓ ${sourced} of ${catalogue.length} lots describe real objects`);
  }
  return catalogue;
}

/* -------------------------------------------------------------------------- */
/* Bid choreography                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build a geometric ladder of proxy maximums from the opening price up to
 * roughly `start * top`.
 *
 * Each rung is forced at least one increment above the last, because a
 * challenger whose ceiling merely equals the leader's loses the tie and the
 * bid history stops advancing — realistic, but not what we want in every lot.
 */
function bidLadder(startCents: number, rounds: number, top: number, jitter: () => number): number[] {
  if (rounds <= 0) return [];
  const factor = Math.pow(top, 1 / rounds);
  const out: number[] = [];
  let value = startCents;
  for (let i = 0; i < rounds; i++) {
    value = value * factor * (0.97 + jitter() * 0.08);
    const step = incrementFor(value);
    // Round to the increment ladder so the numbers read like a saleroom's.
    let rung = Math.round(value / step) * step;
    const floor = i === 0 ? startCents : out[i - 1] + incrementFor(out[i - 1]);
    if (rung < floor) rung = floor;
    out.push(rung);
    value = rung;
  }
  return out;
}

/** Deterministic Fisher-Yates. `sort(() => rand() - 0.5)` is not a shuffle. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const started = Date.now();
  console.log("→ clearing previous demo data");
  await wipe();

  // The consignment wizard offers these as an alternative to supplying a
  // photograph. They are interface furniture rather than lot artwork, so they
  // are written once here and exempted from the stale-plate sweep.
  const housePlates = writeHousePlates();
  console.log(`✓ ${housePlates.length} house plates for the consignment wizard`);

  /* -- Categories ------------------------------------------------------- */
  const categoryId = new Map<CategoryKey, string>();
  await db.insert(t.categories).values(
    CATEGORIES.map((c, i) => {
      const id = `cat_${c.key}`;
      categoryId.set(c.key, id);
      return {
        id,
        slug: c.key,
        name: c.name,
        description: c.description,
        accent: c.accent,
        icon: c.icon,
        sortOrder: i * 10,
      };
    }),
  );
  console.log(`✓ ${CATEGORIES.length} categories`);

  /* -- People ----------------------------------------------------------- */
  // Better Auth owns password hashing and the `account` row, so users are
  // created through the public sign-up API and only then patched with the
  // fields sign-up deliberately refuses to accept from a client (role,
  // verification, reputation).
  const userId = new Map<string, string>();
  for (const person of PEOPLE) {
    const signUp = await auth.api.signUpEmail({
      body: { email: person.email, password: person.password, name: person.name },
    });
    const id = signUp.user.id;
    userId.set(person.key, id);

    await db
      .update(t.user)
      .set({
        role: person.role,
        handle: person.handle,
        bio: person.bio,
        location: person.location,
        image: writeAvatar(person.handle, person.name),
        sellerVerified: person.sellerVerified ?? false,
        ratingAvg: person.ratingAvg ?? 0,
        ratingCount: person.ratingCount ?? 0,
        emailVerified: true,
        createdAt: at(-rand.int(120, 900) * DAY),
      })
      .where(eq(t.user.id, id));

    // Funds move through the ledger, never straight into `wallets`: the cached
    // balance has to be explained by an entry or reconciliation will disagree.
    await db.transaction(async (tx) => {
      await credit(tx, id, person.fundsCents, {
        kind: "deposit",
        memo: "Opening balance",
        refType: "seed",
        refId: "opening",
      });
    });
  }
  console.log(`✓ ${PEOPLE.length} users created and funded`);

  /* -- Lots ------------------------------------------------------------- */
  // The museums are asked once, up front. Everything downstream — bidding,
  // settlement, the evening sale — works on the result without caring whether
  // a lot's identity came from Chicago or from this file.
  const LOTS = await buildCatalogue();

  interface Placed {
    id: string;
    slug: string;
    images: string[];
    spec: LotSpec;
  }
  const placed: Placed[] = [];

  for (const spec of LOTS) {
    const slug = slugify(spec.title);
    const id = `auc_${nanoid(16)}`;

    // Sold and passed lots have to be born live: `placeBid` refuses a closed
    // lot, so they are run forward and then backdated once settled.
    const terminal = spec.status === "sold" || spec.status === "passed";
    const startsAt = terminal
      ? at(-2 * HOUR)
      : spec.status === "scheduled"
        ? at(spec.startsInMs ?? DAY)
        : at(-rand.int(1, 9) * DAY);
    const endsAt = terminal
      ? at(6 * HOUR)
      : spec.status === "scheduled"
        ? at((spec.startsInMs ?? DAY) + rand.int(5, 10) * DAY)
        : at(spec.endsInMs ?? 12 * HOUR);

    // Real photography where the institution released it, generated plates
    // where it did not. `downloadLotImages` is all-or-nothing on purpose: a
    // lot whose hero is a museum photograph and whose second view is an
    // abstract pattern looks broken rather than mixed.
    const plates = spec.imageUrls?.length ? await downloadLotImages(slug, spec.imageUrls, 3) : [];
    const images = plates.length > 0 ? plates : writeLotArt(slug, rand.int(2, 4));

    await db.insert(t.auctions).values({
      id,
      slug,
      sellerId: userId.get(spec.seller)!,
      categoryId: categoryId.get(spec.category)!,
      title: spec.title,
      description: spec.description,
      provenance: spec.provenance,
      condition: spec.condition,
      sourceName: spec.sourceName ?? null,
      sourceUrl: spec.sourceUrl ?? null,
      sourceLicense: spec.sourceLicense ?? null,
      images,
      type: spec.type ?? "timed",
      status: terminal ? "live" : spec.status,
      startingPriceCents: spec.startCents,
      reservePriceCents: spec.reserveCents,
      buyNowPriceCents: spec.buyNowCents,
      // Seeded to the opening price rather than 0 so an unbid lot still quotes
      // the ask; the engine treats the first bid by `bidCount`, not by price.
      currentPriceCents: spec.startCents,
      buyersPremiumBps: spec.buyersPremiumBps ?? 1000,
      startsAt,
      endsAt,
      originalEndsAt: endsAt,
      viewCount: rand.int(40, 4_800),
      createdAt: at(-rand.int(3, 40) * DAY),
    });

    placed.push({ id, slug, images, spec });
  }
  const fromMuseums = placed.filter((l) => l.spec.sourceName).length;
  const photographed = placed.filter((l) => l.images[0]?.endsWith(".jpg")).length;
  console.log(
    `✓ ${placed.length} lots written (${fromMuseums} from museum records, ` +
      `${photographed} with museum plates, ${placed.length - photographed} with generated art)`,
  );

  // Museum results shift between runs and the generated-plate count is a random
  // draw, so each re-seed leaves a little litter. Without this sweep
  // `public/lots` keeps the plates of every catalogue the seed has ever made.
  const swept = pruneStalePlates(new Set(placed.flatMap((l) => l.images)));
  if (swept > 0) console.log(`✓ ${swept} stale plate(s) removed from public/lots`);

  /* -- Bidding ---------------------------------------------------------- */
  const ROOM = ["ava", "priya", "gustav", "nadia", "meiling", "thomas", "dario", "eleanor", "yusuf"];
  const fundsByKey = new Map(PEOPLE.map((p) => [p.key, p.fundsCents]));
  let bidCalls = 0;
  let skippedForFunds = 0;
  let rejected = 0;

  for (const lot of placed) {
    if (lot.spec.rounds === 0) continue;

    const ladder = bidLadder(lot.spec.startCents, lot.spec.rounds, lot.spec.top, rand.next);

    // Three to six regulars per lot, never the consignor, cycled so leadership
    // changes hands instead of one bidder walking their own ceiling upward.
    //
    // Candidates are filtered by opening balance against the deposit the top
    // rung will demand: without this, a seven-figure motor car ends up with a
    // two-bidder history because everyone else is turned away at the door.
    const ceiling = ladder[ladder.length - 1] ?? lot.spec.startCents;
    const affordable = ROOM.filter(
      (key) => key !== lot.spec.seller && (fundsByKey.get(key) ?? 0) >= ceiling / 10,
    );
    const candidates = affordable.length >= 3
      ? affordable
      : // Nobody can carry this lot comfortably; fall back to the deepest
        // pockets in the room and let the per-bid guard sort out the rest.
        [...ROOM]
          .filter((key) => key !== lot.spec.seller)
          .sort((a, b) => (fundsByKey.get(b) ?? 0) - (fundsByKey.get(a) ?? 0))
          .slice(0, 4);
    const pool = shuffle(candidates).slice(0, rand.int(3, Math.min(6, candidates.length)));

    for (let i = 0; i < ladder.length; i++) {
      const bidderKey = pool[i % pool.length];
      const bidderId = userId.get(bidderKey)!;
      const maxAmountCents = ladder[i];

      // The engine requires 10% of the bidder's ceiling to be available before
      // it will seat the bid. Checking here keeps the seed deterministic: a
      // short bidder is skipped rather than blowing up mid-catalogue.
      const [wallet] = await db
        .select()
        .from(t.wallets)
        .where(eq(t.wallets.userId, bidderId))
        .limit(1);
      if (!wallet || wallet.availableCents < Math.round(maxAmountCents / 10)) {
        skippedForFunds++;
        continue;
      }

      const result = await placeBid({
        auctionId: lot.id,
        bidderId,
        maxAmountCents,
        idempotencyKey: `seed-${lot.slug}-${i}`,
        ipAddress: `203.0.113.${rand.int(2, 250)}`,
      });
      bidCalls++;
      if (!result.ok) {
        rejected++;
        console.warn(`  ! ${lot.slug} round ${i}: ${result.reason} — ${result.message}`);
      }
    }

    // The closing bid, when the lot is spoken for.
    if (lot.spec.closingBidder) {
      const top = ladder[ladder.length - 1];
      const step = incrementFor(top);
      const closing = Math.round((top * 1.12) / step) * step + step;
      const result = await placeBid({
        auctionId: lot.id,
        bidderId: userId.get(lot.spec.closingBidder)!,
        maxAmountCents: closing,
        idempotencyKey: `seed-${lot.slug}-final`,
        ipAddress: `203.0.113.${rand.int(2, 250)}`,
      });
      bidCalls++;
      if (!result.ok) {
        rejected++;
        console.warn(`  ! ${lot.slug} closing bid: ${result.reason} — ${result.message}`);
      }
    }
  }
  console.log(
    `✓ ${bidCalls} bids driven through the engine (${skippedForFunds} skipped for funds, ${rejected} rejected)`,
  );

  /* -- Settle the terminal lots ----------------------------------------- */
  // `closeAuction` does the real work — winner, order, deposit capture,
  // deposit releases, events, notifications — and only then are the timestamps
  // pushed into the past so the lot looks like it ended last week.
  let sold = 0;
  let passed = 0;
  for (const lot of placed) {
    if (lot.spec.status !== "sold" && lot.spec.status !== "passed") continue;

    const outcome = await closeAuction(lot.id, { force: true });
    if (outcome.outcome === "sold") sold++;
    if (outcome.outcome === "passed") passed++;
    if (outcome.outcome !== lot.spec.status) {
      console.warn(`  ! ${lot.slug} settled as "${outcome.outcome}", expected "${lot.spec.status}"`);
    }

    const closedAt = at(-rand.int(2, 21) * DAY);
    const openedAt = new Date(closedAt.getTime() - rand.int(7, 14) * DAY);
    await db
      .update(t.auctions)
      .set({
        startsAt: openedAt,
        endsAt: closedAt,
        originalEndsAt: closedAt,
        closedAt,
        createdAt: new Date(openedAt.getTime() - rand.int(3, 20) * DAY),
        updatedAt: closedAt,
      })
      .where(eq(t.auctions.id, lot.id));

    // The order was raised a moment ago; date it to the sale, not to the seed.
    await db
      .update(t.orders)
      .set({ createdAt: closedAt, updatedAt: closedAt })
      .where(eq(t.orders.auctionId, lot.id));
  }
  console.log(`✓ settled ${sold} sold, ${passed} passed`);

  /* -- The evening sale -------------------------------------------------- */
  const saleLots = placed
    .filter((l) => l.spec.saleLot !== undefined)
    .sort((a, b) => a.spec.saleLot! - b.spec.saleLot!);

  const saleId = `sal_${nanoid(16)}`;
  await db.insert(t.sales).values({
    id: saleId,
    slug: "the-midnight-vault-evening-sale",
    title: "The Midnight Vault — Evening Sale",
    description:
      "Seven lots worked from the rostrum in real time: horology, a single-owner motor car, and the antiquity that opens the season. Bidding is by the room, by telephone and online simultaneously.",
    hostId: userId.get("iris")!,
    status: "live",
    scheduledFor: at(-40 * MINUTE),
    startedAt: at(-40 * MINUTE),
    // The lot presently on the block. The room follows this field.
    currentAuctionId: saleLots[2]?.id ?? saleLots[0].id,
    // The first lot's own hero plate, whatever its extension turned out to be.
    coverImage: placed.find((l) => l.spec.saleLot === 1)?.images[0] ?? null,
    createdAt: at(-18 * DAY),
  });

  for (const lot of saleLots) {
    await db
      .update(t.auctions)
      .set({ saleId, lotNumber: lot.spec.saleLot })
      .where(eq(t.auctions.id, lot.id));
  }
  console.log(`✓ 1 live sale with ${saleLots.length} lots on the block`);

  /* -- Engagement -------------------------------------------------------- */
  const ava = userId.get("ava")!;

  // Watchlist: things Ava is following but has not necessarily bid on.
  const watched = placed
    .filter((l) => l.spec.status === "live" || l.spec.status === "scheduled")
    .slice(0, 7);
  await db.insert(t.watchlist).values(
    watched.map((l, i) => ({
      userId: ava,
      auctionId: l.id,
      createdAt: at(-(i + 1) * 9 * HOUR),
    })),
  );
  // `watchCount` is denormalised on the lot, so it has to move with the rows.
  for (const l of watched) {
    await db
      .update(t.auctions)
      .set({ watchCount: sql`${t.auctions.watchCount} + 1` })
      .where(eq(t.auctions.id, l.id));
  }

  // The engine has already written every "outbid", "won" and "sold"
  // notification. These are the ones no bid produces.
  const firstSaleLot = saleLots[0];
  await db.insert(t.notifications).values([
    {
      id: `ntf_${nanoid(18)}`,
      userId: ava,
      type: "welcome",
      title: "Welcome to Auctioneer",
      body: "Your paddle is registered and your wallet is funded. Deposits are held only while you lead a lot.",
      href: "/account",
      createdAt: at(-6 * DAY),
    },
    {
      id: `ntf_${nanoid(18)}`,
      userId: ava,
      type: "sale_starting",
      title: "The Midnight Vault is on the block",
      body: "Seven lots, live now, worked from the rostrum by Iris Okonkwo.",
      href: "/sales/the-midnight-vault-evening-sale",
      payload: { saleId },
      createdAt: at(-38 * MINUTE),
    },
    {
      id: `ntf_${nanoid(18)}`,
      userId: ava,
      type: "watchlist_ending",
      title: "A watched lot closes within the hour",
      body: `${watched[0]?.spec.title ?? "A lot you are watching"} is approaching the hammer.`,
      href: `/lot/${watched[0]?.slug ?? ""}`,
      createdAt: at(-12 * MINUTE),
    },
    {
      id: `ntf_${nanoid(18)}`,
      userId: ava,
      type: "deposit",
      title: "Funds cleared",
      body: "$250,000.00 is available to bid with.",
      href: "/wallet",
      readAt: at(-5 * DAY),
      createdAt: at(-6 * DAY),
    },
  ]);

  // Room chatter on the lot currently under the hammer.
  const chatLot = saleLots[2] ?? saleLots[0];
  const CHATTER: Array<[persona: string, body: string]> = [
    ["thomas", "Anyone in the room seen this one in person? It reads very differently under gallery light."],
    ["ava", "Saw it at the view yesterday. Rather smaller than the catalogue photograph suggests."],
    ["priya", "Estimate feels light for something of this quality."],
    ["nadia", "Iris is moving quickly tonight. Three lots in eleven minutes."],
    ["meiling", "The provenance is the line that matters here, and it is all in the note."],
    ["ava", "Agreed. That is the whole difference between this and the one that came up in March."],
    ["dario", "Phone bidder is back in."],
    ["gustav", "Two on the telephones now."],
    ["thomas", "There it is."],
  ];
  await db.insert(t.chatMessages).values(
    CHATTER.map(([persona, body], i) => ({
      id: `cht_${nanoid(18)}`,
      auctionId: chatLot.id,
      userId: userId.get(persona)!,
      body,
      createdAt: at(-(CHATTER.length - i) * 90_000),
    })),
  );
  console.log(`✓ ${watched.length} watchlist rows, 4 notifications, ${CHATTER.length} chat messages`);

  /* -- Verification ------------------------------------------------------ */
  await report(started);
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                   */
/* -------------------------------------------------------------------------- */

async function count(table: string): Promise<number> {
  const res = await db.execute<{ n: string }>(
    sql.raw(`select count(*)::int as n from ${table}`),
  );
  return Number(res.rows[0]?.n ?? 0);
}

async function report(startedAt: number) {
  const tables = [
    "categories",
    '"user"',
    "wallets",
    "ledger_entries",
    "bid_deposits",
    "auctions",
    "bids",
    "auction_events",
    "sales",
    "orders",
    "watchlist",
    "notifications",
    "chat_messages",
  ];

  console.log("\n┌─ Row counts ────────────────────────────────");
  for (const table of tables) {
    console.log(`│  ${table.replace(/"/g, "").padEnd(18)} ${String(await count(table)).padStart(6)}`);
  }
  console.log("└─────────────────────────────────────────────");

  const byStatus = await db
    .select({ status: t.auctions.status, n: sql<number>`count(*)::int` })
    .from(t.auctions)
    .groupBy(t.auctions.status);
  console.log(
    "\nLots by status:  " + byStatus.map((r) => `${r.status}=${r.n}`).join("  "),
  );

  /* -- Catalogue provenance ---------------------------------------------- *
   * The point of the museum sources is that a lot can say where its facts
   * came from. Counting the rows that can is the only way to notice that a
   * source quietly stopped answering.                                       */
  const byCategory = await db.execute<{ slug: string; n: number; sourced: number }>(sql`
    select c.slug,
           count(*)::int                                            as n,
           count(*) filter (where a.source_name is not null)::int    as sourced
      from auctions a
      join categories c on c.id = a.category_id
     group by c.slug
     order by c.slug
  `);
  console.log("\nLots by category (sourced / total):");
  for (const row of byCategory.rows) {
    console.log(`  ${row.slug.padEnd(16)} ${String(row.sourced).padStart(2)} / ${row.n}`);
  }

  const attribution = await db.execute<{
    sourced: number;
    with_url: number;
    with_licence: number;
    with_provenance: number;
    real_provenance: number;
    sources: string;
  }>(sql`
    select count(*) filter (where source_name is not null)::int     as sourced,
           count(*) filter (where source_url is not null)::int      as with_url,
           count(*) filter (where source_license is not null)::int  as with_licence,
           count(*) filter (where provenance is not null
                              and provenance <> '')::int            as with_provenance,
           -- A published ownership chain, as opposed to our honest note that
           -- there isn't one. Only the Art Institute gives us these.
           count(*) filter (where source_name is not null
                              and provenance is not null
                              and provenance not like 'Not %')::int as real_provenance,
           coalesce(string_agg(distinct source_name, ', '), 'none') as sources
      from auctions
  `);
  const attr = attribution.rows[0];
  console.log(`\nCatalogue records from open-access sources: ${attr.sourced}`);
  console.log(`  with source_url / source_license      : ${attr.with_url} / ${attr.with_licence}`);
  console.log(`  lots carrying a provenance note       : ${attr.with_provenance}`);
  console.log(`  of which a published ownership chain  : ${attr.real_provenance}`);
  console.log(`  sources: ${attr.sources}`);

  /* -- Invariant 0: every plate the catalogue points at exists ----------- */
  const plated = await db.select({ slug: t.auctions.slug, images: t.auctions.images }).from(t.auctions);
  const missing = plated.flatMap((row) =>
    row.images.filter((src) => !existsSync(path.resolve(process.cwd(), "public", src.replace(/^\//, "")))),
  );
  const totalPlates = plated.reduce((n, row) => n + row.images.length, 0);
  console.log(`\nImage files referenced: ${totalPlates}, missing on disk: ${missing.length}  (must be 0)`);
  for (const src of missing.slice(0, 5)) console.log(`  ! ${src}`);

  /* -- Invariant 1: price never regresses below the ask ------------------ */
  const belowStart = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.auctions)
    .where(sql`${t.auctions.currentPriceCents} < ${t.auctions.startingPriceCents}`);
  console.log(`Auctions with currentPrice < startingPrice: ${belowStart[0].n}  (must be 0)`);

  /* -- Invariant 2: the wallet cache agrees with the ledger -------------- *
   * `ledger_entries.amountCents` is the signed change in the wallet's TOTAL
   * claim, so hold placements and releases carry 0 and the invariant the
   * ledger module documents is:
   *     sum(amountCents) == availableCents + heldCents
   * `availableAfterCents` on the newest entry is checked too, because that is
   * the column a statement screen reads rather than recomputing.            */
  const walletCheck = await db.execute<{
    wallets: number;
    total_mismatch: number;
    snapshot_mismatch: number;
    total_available: string;
    total_held: string;
    total_ledger: string;
  }>(sql`
    with sums as (
      select w.id,
             w.available_cents,
             w.held_cents,
             coalesce(sum(l.amount_cents), 0) as ledger_total,
             (select l2.available_after_cents
                from ledger_entries l2
               where l2.wallet_id = w.id
               order by l2.created_at desc, l2.id desc
               limit 1)                       as latest_snapshot
        from wallets w
        left join ledger_entries l on l.wallet_id = w.id
       group by w.id, w.available_cents, w.held_cents
    )
    select count(*)::int                                                          as wallets,
           count(*) filter (
             where available_cents + held_cents <> ledger_total
           )::int                                                                 as total_mismatch,
           count(*) filter (
             where latest_snapshot is not null and available_cents <> latest_snapshot
           )::int                                                                 as snapshot_mismatch,
           sum(available_cents)::text                                             as total_available,
           sum(held_cents)::text                                                  as total_held,
           sum(ledger_total)::text                                                as total_ledger
      from sums
  `);
  const w = walletCheck.rows[0];
  console.log(`\nWallets: ${w.wallets}`);
  console.log(`  available + held != sum(ledger.amount_cents)          : ${w.total_mismatch}  (must be 0)`);
  console.log(`  available != latest ledger available_after_cents      : ${w.snapshot_mismatch}  (must be 0)`);
  console.log(`  total available: $${(Number(w.total_available) / 100).toLocaleString("en-US")}`);
  console.log(`  total held:      $${(Number(w.total_held) / 100).toLocaleString("en-US")}`);
  console.log(`  ledger total:    $${(Number(w.total_ledger) / 100).toLocaleString("en-US")}`);

  /* -- Invariant 3: held cash matches the open deposits ------------------ */
  const heldCheck = await db.execute<{ mismatched: number }>(sql`
    select count(*)::int as mismatched
      from wallets w
      left join (
        select d.user_id, sum(d.amount_cents) as held
          from bid_deposits d
         where d.status = 'held'
         group by d.user_id
      ) d on d.user_id = w.user_id
     where w.held_cents <> coalesce(d.held, 0)
  `);
  console.log(`  held_cents != sum(open bid_deposits)                  : ${heldCheck.rows[0].mismatched}  (must be 0)`);

  /* -- Credentials ------------------------------------------------------- */
  console.log("\n┌─ Demo logins ───────────────────────────────────────────");
  for (const l of DEMO_LOGINS) {
    console.log(`│  ${l.role.padEnd(7)}  ${l.email.padEnd(24)}  ${l.password}`);
  }
  console.log("└─────────────────────────────────────────────────────────");
  console.log(`\nSeeded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("\nSeed failed:", error);
    await pool.end();
    process.exit(1);
  });
