import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SignUpForm } from "@/components/account/sign-up-form";
import { safeNext } from "@/components/account/next-param";

export const metadata: Metadata = {
  title: "Register to bid",
  description: "Create an Auctioneer paddle. Free, and you can bid immediately.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const destination = safeNext(next);

  const session = await getSession();
  if (session?.user) redirect(destination);

  return <SignUpForm next={destination} />;
}
