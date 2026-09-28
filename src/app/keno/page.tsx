import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { getSeedStatus } from "../../lib/seeds";
import { currentUserId } from "../../lib/supabase/server";
import { getAccount, getBalance } from "../../lib/wallet";
import { KenoGame } from "./keno-game";

export const metadata: Metadata = {
  title: "Keno — Degenerate Gambling Corner",
  description: "Pick up to ten of forty numbers. Ten are drawn. The full pay table and the exact house edge are printed.",
};

export default async function KenoPage() {
  const id = await currentUserId();
  const account = id ? await getAccount(id) : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-gutter py-12">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-fg-muted hover:text-fg">
          ← Degenerate Gambling Corner
        </Link>
        <h1 className="text-3xl font-bold text-fg">Keno</h1>
        <p className="text-base text-fg-muted">
          Pick 1 to 10 numbers from 40. The server draws 10. What you get paid depends on how many of yours
          came up, and the whole table is printed beside the board, along with the exact house edge for your
          pick count. It runs from exactly 1% (one pick) to 1.22% (four picks), because the payouts are rounded
          down, never up.
        </p>
      </header>

      {id && account ? (
        <SignedIn id={id} />
      ) : (
        <Card title="Sign in to play" description="Keno uses play coins from your account. They are free and worth nothing.">
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
  return <KenoGame initialBalance={balance} seeds={seeds} />;
}
