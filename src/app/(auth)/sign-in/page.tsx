import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SignInForm } from "@/components/account/sign-in-form";
import { safeNext } from "@/components/account/next-param";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Auctioneer to bid, consign and settle.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const destination = safeNext(next);

  // Somebody already holding a session has no business on the door.
  const session = await getSession();
  if (session?.user) redirect(destination);

  return <SignInForm next={destination} />;
}
