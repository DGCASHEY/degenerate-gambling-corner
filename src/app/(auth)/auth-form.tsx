"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "../../components/ui/button";
import { Field, Input } from "../../components/ui/input";
import { signIn, signUp, type FormState } from "./actions";

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    mode === "signup" ? signUp : signIn,
    {},
  );

  if (state.done) {
    return <p className="text-base text-fg">{state.done}</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {mode === "signup" ? (
        <Field id="username" label="Username" hint="Shown on the leaderboard unless you hide it.">
          <Input id="username" name="username" required autoComplete="username" maxLength={20} />
        </Field>
      ) : null}
      <Field id="email" label="Email">
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Field id="password" label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
      </Field>

      {mode === "signup" ? (
        <label className="flex items-start gap-3 text-sm text-fg">
          <input type="checkbox" name="age_confirmed" required className="mt-0.5 size-4 accent-accent" />
          <span>I am 18 or older.</span>
        </label>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-loss">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {mode === "signup" ? "Create account" : "Sign in"}
      </Button>

      <p className="text-sm text-fg-muted">
        {mode === "signup" ? (
          <>
            Already have an account? <Link href="/login" className="text-accent-text underline">Sign in</Link>
          </>
        ) : (
          <>
            No account yet? <Link href="/signup" className="text-accent-text underline">Create one</Link>
          </>
        )}
      </p>
    </form>
  );
}
