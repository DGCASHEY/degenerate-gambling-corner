import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { getSeedStatus } from "../../lib/seeds";
import { currentUserId } from "../../lib/supabase/server";
import { getAccount, getBalance } from "../../lib/wallet";
import { LimboGame } from "./limbo-game";

export const metadata: Metadata = {
  title: "Limbo — Degenerate Gambling Corner",
  description: "Name a multiplier. The result either clears it or doesn't. The house edge is 1%.",
};

export default async function LimboPage() {
  const id = await currentUserId();
  const account = id ? await getAccount(id) : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-gutter py-12">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-fg-muted hover:text-fg">
          ← Degenerate Gambling Corner
        </Link>
        <h1 className="text-3xl font-bold text-fg">Limbo</h1>
        <p className="text-base text-fg-muted">
          Name a multiplier from 1.01× to 1,000,000×. The server draws a result. If it reaches your target,
          you are paid your bet times the target. The chance of that is 99% divided by the target, so 2× hits
          49.5% of the time. The missing 1% is the house edge.
        </p>
      </header>

      {id && account ? (
        <SignedIn id={id} />
      ) : (
        <Card title="Sign in to play" description="Limbo uses play coins from your account. They are free and worth nothing.">
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
  return <LimboGame initialBalance={balance} seeds={seeds} />;
}
