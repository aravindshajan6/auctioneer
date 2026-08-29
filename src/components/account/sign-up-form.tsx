"use client";

import Link from "next/link";
import * as React from "react";
import { AlertCircle, ArrowRight, Check } from "lucide-react";
import { z } from "zod";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { PasswordInput } from "./password-input";
import { cn } from "@/lib/utils";

/** Mirrors `emailAndPassword.minPasswordLength` in src/lib/auth/index.ts. */
const MIN_PASSWORD_LENGTH = 8;

const SignUpSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "We need a name to put against your bids.")
      .max(64, "That name is too long for a paddle."),
    email: z
      .string()
      .trim()
      .min(1, "An email address is required.")
      .email("That does not look like an email address."),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      .max(128, "That password is longer than we can store."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Both passwords must match.",
  });

type FieldName = "name" | "email" | "password" | "confirm";

export function SignUpForm({ next }: { next: string }) {
  const [values, setValues] = React.useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = React.useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  // Individually named rather than a lookup object: a record of refs reads as
  // ref access during render, and React's lint rule is right to object.
  const nameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const confirmRef = React.useRef<HTMLInputElement>(null);

  function focusFirstError(found: Partial<Record<FieldName, string>>) {
    if (found.name) nameRef.current?.focus();
    else if (found.email) emailRef.current?.focus();
    else if (found.password) passwordRef.current?.focus();
    else if (found.confirm) confirmRef.current?.focus();
  }

  const set = (field: FieldName) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setValues((prev) => ({ ...prev, [field]: value }));
    // Clear a field's error as soon as it is touched; leaving stale red on a
    // field somebody is actively fixing reads as "still wrong".
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = SignUpSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldName;
        fieldErrors[key] ??= issue.message;
      }
      setErrors(fieldErrors);
      focusFirstError(fieldErrors);
      return;
    }

    setErrors({});
    setPending(true);

    const { error } = await authClient.signUp.email({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
    });

    if (error) {
      setPending(false);
      if (error.code === "USER_ALREADY_EXISTS") {
        setErrors({ email: "That address is already registered — sign in instead." });
        emailRef.current?.focus();
        return;
      }
      setFormError(error.message ?? "We could not create your account. Try again in a moment.");
      return;
    }

    // Better Auth signs the new account in as part of sign-up, so a full
    // navigation lands them inside the app already authenticated.
    window.location.assign(next);
  }

  const passwordLongEnough = values.password.length >= MIN_PASSWORD_LENGTH;
  const passwordsMatch = values.confirm.length > 0 && values.confirm === values.password;

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-linen sm:text-[2.1rem]">
        Register to bid
      </h1>
      <p className="mt-2 text-sm text-fog">
        Free, immediate, and worth about ninety seconds. New paddles start with a simulated
        wallet so you can bid the moment you are through the door.
      </p>

      {formError && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-ember-500/45 bg-ember-500/10 px-3.5 py-3 text-[13px] text-ember-300"
        >
          <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
          {formError}
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-7 space-y-5">
        <div>
          <Label htmlFor="signup-name">Name on the paddle</Label>
          <Input
            id="signup-name"
            ref={nameRef}
            name="name"
            autoComplete="name"
            placeholder="Marguerite Vance"
            value={values.name}
            onChange={set("name")}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "signup-name-error" : undefined}
            className="aria-[invalid=true]:border-ember-500/70"
          />
          <span id="signup-name-error">
            <FieldError>{errors.name}</FieldError>
          </span>
        </div>

        <div>
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={values.email}
            onChange={set("email")}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "signup-email-error" : undefined}
            className="aria-[invalid=true]:border-ember-500/70"
          />
          <span id="signup-email-error">
            <FieldError>{errors.email}</FieldError>
          </span>
        </div>

        <div>
          <Label htmlFor="signup-password">Password</Label>
          <PasswordInput
            id="signup-password"
            ref={passwordRef}
            name="password"
            autoComplete="new-password"
            placeholder={"At least " + MIN_PASSWORD_LENGTH + " characters"}
            value={values.password}
            onChange={set("password")}
            aria-invalid={Boolean(errors.password)}
            aria-describedby="signup-password-hint"
          />
          <p id="signup-password-hint" className="mt-1.5 flex items-center gap-1.5 text-xs">
            <Check
              className={cn(
                "size-3.5 transition-colors",
                passwordLongEnough ? "text-signal-400" : "text-pewter",
              )}
              aria-hidden
            />
            <span className={passwordLongEnough ? "text-fog" : "text-ash"}>
              {MIN_PASSWORD_LENGTH} characters minimum
            </span>
          </p>
          <FieldError>{errors.password}</FieldError>
        </div>

        <div>
          <Label htmlFor="signup-confirm">Confirm password</Label>
          <PasswordInput
            id="signup-confirm"
            ref={confirmRef}
            name="confirm"
            autoComplete="new-password"
            placeholder="Type it once more"
            value={values.confirm}
            onChange={set("confirm")}
            aria-invalid={Boolean(errors.confirm)}
            aria-describedby={errors.confirm ? "signup-confirm-error" : undefined}
          />
          {passwordsMatch && !errors.confirm && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-signal-400">
              <Check className="size-3.5" aria-hidden />
              Passwords match
            </p>
          )}
          <span id="signup-confirm-error">
            <FieldError>{errors.confirm}</FieldError>
          </span>
        </div>

        <Button type="submit" variant="gild" size="lg" className="w-full" loading={pending}>
          Create account
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </form>

      <p className="mt-6 text-sm text-ash">
        Already have a paddle?{" "}
        <Link
          href={`/sign-in${next === "/explore" ? "" : `?next=${encodeURIComponent(next)}`}`}
          className="text-gild-200 underline decoration-gild-600/60 underline-offset-4 transition-colors hover:text-gild-100"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
