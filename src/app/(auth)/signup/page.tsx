import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account — Degenerate Gambling Corner" };

export default function SignUpPage() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Create an account</h1>
        <p className="text-sm text-fg-muted">
          You start with 5,000 play coins. They are worth nothing, can&apos;t be
          bought and can&apos;t be cashed out. That is the entire point.
        </p>
      </div>
      <AuthForm mode="signup" />
    </>
  );
}
