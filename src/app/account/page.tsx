import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { formatCoins } from "../../components/ui/format";
import { currentUserId } from "../../lib/supabase/server";
import { getAccount, getBalance, getFaucetStatus, unitsToCoins } from "../../lib/wallet";
import { signOut } from "../(auth)/actions";
import { FaucetButton, PrivacyForm } from "./forms";

export const metadata: Metadata = { title: "Your account — Degenerate Gambling Corner" };

function waitText(readyAt: Date | null): string | null {
  if (!readyAt) return null;
  const minutes = Math.max(1, Math.ceil((readyAt.getTime() - Date.now()) / 60_000));
  if (minutes < 60) return `Ready in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Ready in ${hours} h ${minutes % 60} min`;
}

export default async function AccountPage() {
  const id = await currentUserId();
  if (!id) redirect("/login");

  const [account, balance, faucet] = await Promise.all([
    getAccount(id),
    getBalance(id),
    getFaucetStatus(id),
  ]);
  if (!account) redirect("/login");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-gutter py-12">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{account.username}</h1>
        <form action={signOut}>
          <Button type="submit" variant="ghost">Sign out</Button>
        </form>
      </header>

      <Card title="Balance" description="Play coins. Worth nothing, can't be bought, can't be cashed out.">
        <span className="font-mono text-3xl font-bold tabular-nums">
          {formatCoins(unitsToCoins(balance))}
        </span>
      </Card>

      <div className="grid gap-gutter sm:grid-cols-2">
        <Card title="Hourly tap" description="200 coins, once an hour.">
          <FaucetButton
            tap="hourly"
            idempotencyKey={randomUUID()}
            label="Claim 200 coins"
            waitText={waitText(faucet.hourlyReadyAt)}
          />
        </Card>
        <Card title="Daily tap" description="1,000 coins, once every 24 hours.">
          <FaucetButton
            tap="daily"
            idempotencyKey={randomUUID()}
            label="Claim 1,000 coins"
            waitText={waitText(faucet.dailyReadyAt)}
          />
        </Card>
      </div>

      <Card title="Incognito" description="Three separate switches. Each one does exactly what it says.">
        <PrivacyForm
          showInFeed={account.showInFeed}
          showOnLeaderboard={account.showOnLeaderboard}
          publicProfile={account.publicProfile}
        />
      </Card>
    </main>
  );
}
