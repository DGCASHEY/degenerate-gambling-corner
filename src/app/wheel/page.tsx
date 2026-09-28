import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { getSeedStatus } from "../../lib/seeds";
import { currentUserId } from "../../lib/supabase/server";
import { getAccount, getBalance } from "../../lib/wallet";
import { WheelGame } from "./wheel-game";

export const metadata: Metadata = {
  title: "Wheel — Degenerate Gambling Corner",
  description: "Thirty segments, three risk levels, every multiplier printed. The house edge is 1% on all of them.",
};

export default async function WheelPage() {
  const id = await currentUserId();
  const account = id ? await getAccount(id) : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-gutter py-12">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-fg-muted hover:text-fg">
          ← Degenerate Gambling Corner
        </Link>
        <h1 className="text-3xl font-bold text-fg">Wheel</h1>
        <p className="text-base text-fg-muted">
          Thirty segments, each equally likely. Pick a risk level and the server picks a segment. Every
          multiplier on every wheel is listed below the wheel. Add them up, divide by thirty, and you get 0.99
          on all three. The missing 1% is the house edge.
        </p>
      </header>

      {id && account ? (
        <SignedIn id={id} />
      ) : (
        <Card title="Sign in to spin" description="Wheel uses play coins from your account. They are free and worth nothing.">
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/login">Sign in</ButtonLink>
            <ButtonLink href="/signup" variant="secondary">Create account</ButtonLink>
          </div>
        </Card>
      )}
    </main>
  );
}

async function SignedIn({ id }: { id: string }) {
  const [balance, seeds] = await Promise.all([getBalance(id), getSeedStatus(id)]);
  return <WheelGame initialBalance={balance} seeds={seeds} />;
}
