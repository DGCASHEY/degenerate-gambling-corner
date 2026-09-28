import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { getSeedStatus } from "../../lib/seeds";
import { currentUserId } from "../../lib/supabase/server";
import { getAccount, getBalance } from "../../lib/wallet";
import { DiceGame } from "./dice-game";

export const metadata: Metadata = {
  title: "Dice — Degenerate Gambling Corner",
  description: "Pick a number. Roll over or under it. The odds are the number, and the house edge is 1%.",
};

export default async function DicePage() {
  const id = await currentUserId();
  const account = id ? await getAccount(id) : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-gutter py-12">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-fg-muted hover:text-fg">
          ← Degenerate Gambling Corner
        </Link>
        <h1 className="text-3xl font-bold text-fg">Dice</h1>
        <p className="text-base text-fg-muted">
          A roll from 0.00 to 99.99. Pick a target and whether you need to roll under or over it. Your
          win chance is the size of that range, and a win pays 99 divided by it. The missing 1 is the
          house edge. It is printed here because most sites hide it.
        </p>
      </header>

      {id && account ? (
        <SignedIn id={id} />
      ) : (
        <Card title="Sign in to roll" description="Dice uses play coins from your account. They are free and worth nothing.">
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
  return <DiceGame initialBalance={balance} seeds={seeds} />;
}
