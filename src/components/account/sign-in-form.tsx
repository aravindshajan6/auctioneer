"use client";

import Link from "next/link";
import * as React from "react";
import { AlertCircle, ArrowRight, KeyRound } from "lucide-react";
import { z } from "zod";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { PasswordInput } from "./password-input";

const SignInSchema = z.object({
  email: z.string().trim().min(1, "Enter the email you signed up with.").email("That does not look like an email address."),
  password: z.string().min(1, "Enter your password."),
});

type FieldName = "email" | "password";

/**
 * Seeded accounts. Reviewers arrive with no way in, and a demo platform whose
 * front door is a dead end is a demo nobody sees. The credentials are public
 * on purpose.
 */
const DEMO_ACCOUNTS = [
  {
    email: "demo@auctioneer.dev",
    password: "demo1234",
    role: "Bidder",
    blurb: "Funded wallet, live bids in play, a won lot awaiting payment.",
    primary: true,
  },
  {
    email: "seller@auctioneer.dev",
    password: "seller1234",
    role: "Seller",
    blurb: "Consignments on the block, with sale proceeds in the ledger.",
    primary: false,
  },
] as const;

export function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<null | "form" | string>(null);

  // Individually named rather than a lookup object: a record of refs reads as
  // ref access during render, and React's lint rule is right to object.
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  async function authenticate(credentials: { email: string; password: string }) {
    const { error } = await authClient.signIn.email(credentials);
    if (error) {
      // Better Auth returns a deliberately vague code for both a bad password
      // and an unknown address; we keep it vague too rather than confirming
      // which addresses are registered here.
      setFormError(
        error.code === "INVALID_EMAIL_OR_PASSWORD"
          ? "That email and password do not match an account."
          : (error.message ?? "We could not sign you in. Try again in a moment."),
      );
      return false;
    }
    // A hard navigation, not router.push: the session cookie was set by this
    // fetch, and every server component downstream must be rendered with it.
    window.location.assign(next);
    return true;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = SignInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fieldErrors: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldName;
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      // Send the caret to the first thing that is wrong, not to the top.
      if (fieldErrors.email) emailRef.current?.focus();
      else if (fieldErrors.password) passwordRef.current?.focus();
      return;
    }

    setErrors({});
    setPending("form");
    const ok = await authenticate(parsed.data);
    if (!ok) setPending(null);
  }

  async function signInWithDemo(account: (typeof DEMO_ACCOUNTS)[number]) {
    setFormError(null);
    setErrors({});
    // Fill the visible fields first so the reviewer can see what was used —
    // and still has the credentials in front of them if the submit fails.
    setEmail(account.email);
    setPassword(account.password);
    setPending(account.email);
    const ok = await authenticate({ email: account.email, password: account.password });
    if (!ok) setPending(null);
  }

  const busy = pending !== null;

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-linen sm:text-[2.1rem]">
        Sign in
      </h1>
      <p className="mt-2 text-sm text-fog">
        Pick up where you left off — your standing maximums are still working.
      </p>

      {/* The demo panel sits ABOVE the form on purpose: for most people opening
          this page it is the only credential they have. */}
      <section className="mt-7 rounded-2xl border border-gild-600/40 bg-gild-500/[0.06] p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="size-3.5 text-gild-300" aria-hidden />
          <h2 className="text-[11px] font-medium tracking-[0.14em] text-gild-200 uppercase">
            Seeded accounts
          </h2>
        </div>
        <div className="mt-3 space-y-2.5">
          {DEMO_ACCOUNTS.map((account) => (
            <div key={account.email} className="sm:flex sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[12px] text-linen">
                  {account.email} · {account.password}
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-ash">{account.blurb}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={account.primary ? "gild" : "outline"}
                className="mt-2 w-full shrink-0 sm:mt-0 sm:w-auto"
                onClick={() => void signInWithDemo(account)}
                loading={pending === account.email}
                disabled={busy && pending !== account.email}
              >
                Use {account.role.toLowerCase()} demo
              </Button>
            </div>
          ))}
        </div>
      </section>

      {formError && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-ember-500/45 bg-ember-500/10 px-3.5 py-3 text-[13px] text-ember-300"
        >
          <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
          {formError}
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
        <div>
          <Label htmlFor="signin-email">Email</Label>
          <Input
            id="signin-email"
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "signin-email-error" : undefined}
            className="aria-[invalid=true]:border-ember-500/70"
          />
          <span id="signin-email-error">
            <FieldError>{errors.email}</FieldError>
          </span>
        </div>

        <div>
          <Label htmlFor="signin-password">Password</Label>
          <PasswordInput
            id="signin-password"
            ref={passwordRef}
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "signin-password-error" : undefined}
          />
          <span id="signin-password-error">
            <FieldError>{errors.password}</FieldError>
          </span>
        </div>

        <Button
          type="submit"
          variant="gild"
          size="lg"
          className="w-full"
          loading={pending === "form"}
          disabled={busy && pending !== "form"}
        >
          Sign in
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </form>

      <p className="mt-6 text-sm text-ash">
        No account yet?{" "}
        <Link
          href={`/sign-up${next === "/explore" ? "" : `?next=${encodeURIComponent(next)}`}`}
          className="text-gild-200 underline decoration-gild-600/60 underline-offset-4 transition-colors hover:text-gild-100"
        >
          Register to bid
        </Link>
      </p>
    </div>
  );
}
