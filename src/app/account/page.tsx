import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, ButtonLink } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { formatCoins } from "../../components/ui/format";
import { getRevealedSeeds, getSeedStatus } from "../../lib/seeds";
import { currentUserId } from "../../lib/supabase/server";
import { getAccount, getBalance, getFaucetStatus, unitsToCoins } from "../../lib/wallet";
import { signOut } from "../(auth)/actions";
import { FaucetButton, PrivacyForm, SeedForm } from "./forms";

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

  const [account, balance, faucet, seeds, revealed] = await Promise.all([
    getAccount(id),
    getBalance(id),
    getFaucetStatus(id),
    getSeedStatus(id),
    getRevealedSeeds(id),
  ]);
  if (!account) redirect("/login");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-gutter py-12">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{account.username}</h1>
        <div className="flex items-center gap-2">
          <ButtonLink href="/" variant="secondary">Home</ButtonLink>
          <form action={signOut}>
            <Button type="submit" variant="ghost">Sign out</Button>
          </form>
        </div>
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

      <Card
        title="Fairness"
        description="Every result comes from our sealed secret, your client word and a spin number. Check any of it at /fairness."
      >
        <dl className="grid gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-fg-muted">Live secret’s fingerprint</dt>
            <dd className="font-mono break-all text-fg">{seeds.fingerprint}</dd>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="flex flex-col gap-1">
              <dt className="text-fg-muted">Your client word</dt>
              <dd className="font-mono break-all text-fg">{seeds.clientWord}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-fg-muted">Spins played with it</dt>
              <dd className="font-mono tabular-nums text-fg">{seeds.nextSpin}</dd>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-fg-muted">Next secret’s fingerprint, sealed before you pick a new word</dt>
            <dd className="font-mono break-all text-fg">{seeds.nextFingerprint}</dd>
          </div>
        </dl>
        <SeedForm />
        {revealed.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold text-fg">Revealed secrets</h4>
            <ul className="flex flex-col gap-3">
              {revealed.slice(0, 10).map((r) => (
                <li key={r.fingerprint} className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
                  <span className="font-mono break-all text-fg">{r.serverSeed}</span>
                  <span className="text-fg-muted">
                    Word <span className="font-mono text-fg">{r.clientWord}</span> · {r.spins} {r.spins === 1 ? "spin" : "spins"}
                    {" · "}
                    <Link
                      className="text-accent-text underline"
                      href={{ pathname: "/fairness", query: { seed: r.serverSeed, word: r.clientWord, spin: "0", hash: r.fingerprint } }}
                    >
                      Check it
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

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
