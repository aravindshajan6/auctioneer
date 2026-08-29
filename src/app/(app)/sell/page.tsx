import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listCategories } from "@/lib/queries";
import { env } from "@/lib/env";
import { SellWizard } from "@/components/account/sell-wizard";

export const metadata: Metadata = {
  title: "Consign a lot",
  description: "List an object for sale at Auctioneer in five steps.",
};

export default async function SellPage() {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in?next=/sell");

  const categories = await listCategories();
  const cfg = env();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-10 max-w-2xl">
        <p className="text-[11px] font-medium tracking-[0.2em] text-gild-400 uppercase">
          Consignment
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-linen sm:text-4xl">
          Put something on the block
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-fog">
          Five steps: the object, its photographs, what it should open at, when it runs, and a
          last look. Nothing is published until you submit, and{" "}
          <Link
            href="/how-it-works"
            className="text-gild-200 underline decoration-gild-600/60 underline-offset-4 hover:text-gild-100"
          >
            the house rules
          </Link>{" "}
          explain what every setting does to a bidder.
        </p>
      </header>

      {/* The soft-close window is configuration, not a constant, so it is read
          from the server env and handed down rather than hard-coded in copy. */}
      <SellWizard
        categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
        antiSnipe={{
          windowSeconds: cfg.ANTISNIPE_WINDOW_SECONDS,
          extensionSeconds: cfg.ANTISNIPE_EXTENSION_SECONDS,
        }}
      />
    </div>
  );
}
