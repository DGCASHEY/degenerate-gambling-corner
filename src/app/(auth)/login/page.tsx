import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in — Degenerate Gambling Corner" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { confirm } = await searchParams;
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Sign in</h1>
        {confirm === "failed" ? (
          <p className="text-sm text-loss">
            That confirmation link did not work. It may have expired or already been used. Try signing in.
          </p>
        ) : null}
      </div>
      <AuthForm mode="login" />
    </>
  );
}
