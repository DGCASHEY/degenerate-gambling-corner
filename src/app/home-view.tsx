import Image from "next/image";
import Link from "next/link";
import { Badge } from "../components/ui/badge";
import { ButtonLink } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { formatCoins } from "../components/ui/format";
import { games } from "../lib/games";

export type Player = { username: string; coins: number } | null;

const working = [
  {
    title: "The faucet",
    body: "5,000 coins when you sign up. 200 more every hour, 1,000 every day. That is the only way coins appear, apart from winning them back off us.",
  },
  {
    title: "The ledger",
    body: "Every coin that moves is written down once and never edited. Your balance is those lines added up, every time.",
  },
  {
    title: "Incognito",
    body: "Three switches: show you in the bet feed, on the leaderboard, and give you a public profile. Each does one thing.",
  },
  {
    title: "Fairness",
    body: "Every result will be decided on our server and checkable by you afterwards. The verifier is being built next.",
  },
];

export function HomeView({ player }: { player: Player }) {
  return (
    <div className="flex flex-1 flex-col bg-bg">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-gutter py-4">
          <Link href="/" className="font-semibold text-fg">
            <span className="sm:hidden">DGC</span>
            <span className="hidden sm:inline">Degenerate Gambling Corner</span>
          </Link>
          {player ? (
            <nav className="flex items-center gap-3">
              <span className="font-mono text-sm font-semibold tabular-nums text-fg">
                {formatCoins(player.coins)}
              </span>
              <ButtonLink href="/account" variant="secondary" size="sm">
                {player.username}
              </ButtonLink>
            </nav>
          ) : (
            <nav className="flex items-center gap-2">
              <ButtonLink href="/login" variant="ghost" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Create account
              </ButtonLink>
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-section px-gutter py-12">
        <section className="flex flex-col-reverse items-center gap-8 sm:flex-row sm:justify-between">
          <div className="flex max-w-xl flex-col gap-4">
            <h1 className="text-3xl font-bold text-fg sm:text-4xl">
              A casino that tells you exactly how it is taking your coins.
            </h1>
            <p className="text-base text-fg-muted">
              The coins are free and worth nothing. You can&apos;t buy them, win anything with them, or
              cash them out. That is the entire point.
            </p>
            <div>
              {player ? (
                <ButtonLink href="/account" size="lg">
                  Claim your free coins
                </ButtonLink>
              ) : (
                <ButtonLink href="/signup" size="lg">
                  Create an account and get 5,000 play coins
                </ButtonLink>
              )}
            </div>
          </div>
          <Image
            src="/mascot/smug.png"
            alt="The house raccoon, smirking in a velvet jacket and gold chain"
            width={512}
            height={512}
            priority
            className="size-48 shrink-0 rounded-lg border border-border sm:size-64"
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-fg">Games</h2>
          <div className="grid gap-gutter sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game) =>
              game.href ? (
                <Link key={game.name} href={game.href} className="rounded-lg hover:ring-2 hover:ring-accent">
                  <Card title={game.name} description={game.blurb} action={<Badge tone="accent">Play</Badge>} />
                </Link>
              ) : (
                <Card
                  key={game.name}
                  title={game.name}
                  description={game.blurb}
                  action={<Badge>Not built yet</Badge>}
                />
              ),
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-fg">What works right now</h2>
          <div className="grid gap-gutter sm:grid-cols-2">
            {working.map((item) => (
              <Card key={item.title} title={item.title} description={item.body} />
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <p className="mx-auto w-full max-w-5xl px-gutter py-6 text-sm text-fg-muted">
          Play coins only. Nothing here can be bought, won or cashed out. 18+.
        </p>
      </footer>
    </div>
  );
}
