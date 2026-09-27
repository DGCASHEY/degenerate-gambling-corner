import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui/badge";
import { BetPanel } from "../../components/ui/bet-panel";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { FeedList, type FeedBet } from "../../components/ui/feed-row";
import { formatCoins } from "../../components/ui/format";
import { Field, Input, SegmentedControl, Switch } from "../../components/ui/input";
import { Table, Td, Th } from "../../components/ui/table";
import { ThemeSwitch } from "./theme-switch";

export const metadata: Metadata = {
  title: "Design system — Degenerate Gambling Corner",
  robots: { index: false, follow: false },
};

// Every token, listed by name so the swatch class is spelled out in full
// (Tailwind only builds classes it can find written in the code).
const swatches = [
  { name: "bg", className: "bg-bg" },
  { name: "surface", className: "bg-surface" },
  { name: "surface-hover", className: "bg-surface-hover" },
  { name: "inset", className: "bg-inset" },
  { name: "border", className: "bg-border" },
  { name: "border-strong", className: "bg-border-strong" },
  { name: "fg", className: "bg-fg" },
  { name: "fg-muted", className: "bg-fg-muted" },
  { name: "fg-subtle", className: "bg-fg-subtle" },
  { name: "accent", className: "bg-accent" },
  { name: "accent-hover", className: "bg-accent-hover" },
  { name: "accent-text", className: "bg-accent-text" },
  { name: "accent-soft", className: "bg-accent-soft" },
  { name: "win", className: "bg-win" },
  { name: "loss", className: "bg-loss" },
  { name: "warn", className: "bg-warn" },
];

const typeScale = [
  { name: "4xl · 56", className: "text-4xl font-bold font-mono tabular-nums", sample: "2.00×" },
  { name: "3xl · 40", className: "text-3xl font-bold font-mono tabular-nums", sample: "1,024.00" },
  { name: "2xl · 32", className: "text-2xl font-bold", sample: "Dice" },
  { name: "xl · 24", className: "text-xl font-semibold", sample: "Recent bets" },
  { name: "lg · 20", className: "text-lg font-semibold", sample: "Incognito settings" },
  { name: "base · 16", className: "text-base", sample: "Nothing you win here is worth anything. That is the entire point." },
  { name: "sm · 14", className: "text-sm text-fg-muted", sample: "House edge is printed on every game because most sites hide it." },
  { name: "xs · 12", className: "text-xs text-fg-subtle uppercase tracking-wide", sample: "Bet amount" },
];

const spacing = [
  { step: "1", px: 4, className: "w-1" },
  { step: "2", px: 8, className: "w-2" },
  { step: "3", px: 12, className: "w-3" },
  { step: "4", px: 16, className: "w-4" },
  { step: "6", px: 24, className: "w-6" },
  { step: "8", px: 32, className: "w-8" },
  { step: "12", px: 48, className: "w-12" },
  { step: "16", px: 64, className: "w-16" },
  { step: "24", px: 96, className: "w-24" },
];

// Sample data for display only.
const feed: FeedBet[] = [
  { player: "trash_panda", game: "Dice", wager: 10, multiplier: 1.98, profit: 9.8, time: "now" },
  { player: null, game: "Limbo", wager: 250, multiplier: 0, profit: -250, time: "2s" },
  { player: "coinflip_carl", game: "Crash", wager: 5, multiplier: 12.4, profit: 57, time: "4s" },
  { player: "longshot_lou_with_a_very_long_name", game: "Mines", wager: 100, multiplier: 0, profit: -100, time: "9s" },
  { player: "breakeven_bea", game: "Plinko", wager: 20, multiplier: 1, profit: 0, time: "12s" },
];

const leaderboard = [
  { rank: 1, player: "trash_panda", wagered: 182440, bets: 9120 },
  { rank: 2, player: "coinflip_carl", wagered: 96210.5, bets: 4410 },
  { rank: 3, player: "breakeven_bea", wagered: 51002, bets: 2988 },
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {note ? <p className="text-sm text-fg-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default function DesignSystem() {
  return (
    <div className="flex-1 bg-bg">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-gutter py-3">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold">Design system</span>
            <Badge>Internal</Badge>
          </div>
          <ThemeSwitch />
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-section px-gutter py-12">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">Every piece, before any of it is used</h1>
          <p className="max-w-2xl text-base text-fg-muted">
            Colours come from tokens in globals.css, never from raw values.
            Flip the switch above to check each piece in light and dark.
          </p>
        </div>

        <Section title="Colour tokens" note="One accent. Win, loss and warn are for results and warnings only, never decoration.">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {swatches.map((s) => (
              <div key={s.name} className="flex flex-col gap-2">
                <div className={`h-16 rounded-md border border-border ${s.className}`} />
                <code className="font-mono text-xs text-fg-muted">{s.name}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Type scale" note="Geist for words. Geist Mono with even-width digits for every number a player reads.">
          <div className="flex flex-col gap-6">
            {typeScale.map((t) => (
              <div key={t.name} className="grid grid-cols-[5.5rem_1fr] items-baseline gap-4">
                <code className="font-mono text-xs text-fg-subtle">{t.name}</code>
                <span className={`min-w-0 break-words ${t.className}`}>{t.sample}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Spacing scale" note="4px steps. Named gaps: gutter 16, card 24, section 64.">
          <div className="flex flex-col gap-2">
            {spacing.map((s) => (
              <div key={s.step} className="grid grid-cols-[5.5rem_1fr] items-center gap-4">
                <code className="font-mono text-xs text-fg-subtle">
                  {s.step} · {s.px}px
                </code>
                <div className={`h-3 rounded-sm bg-accent ${s.className}`} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons" note="A button says exactly what happens when you press it.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Place bet</Button>
              <Button variant="secondary">Verify this round</Button>
              <Button variant="ghost">Hide balance</Button>
              <Button variant="danger">Stop auto bet</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid gap-6 sm:grid-cols-2">
            <Field id="demo-name" label="Display name" hint="Shown on the leaderboard unless you hide it.">
              <Input id="demo-name" placeholder="trash_panda" />
            </Field>
            <Field id="demo-target" label="Multiplier target">
              <Input id="demo-target" numeric inputMode="decimal" defaultValue="2.00" suffix="×" />
            </Field>
            <Field id="demo-error" label="Bet amount" error="That is more than your balance. Lower the bet or claim from the faucet.">
              <Input id="demo-error" numeric invalid defaultValue="5,000.00" />
            </Field>
            <Field id="demo-disabled" label="Bet amount" hint="Locked while a round is running.">
              <Input id="demo-disabled" numeric disabled defaultValue="10.00" />
            </Field>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-fg-muted">Segmented control</span>
              <SegmentedControl
                name="demo-risk"
                label="Risk"
                defaultValue="medium"
                options={[
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Medium" },
                  { value: "high", label: "High" },
                ]}
              />
            </div>
          </div>
          <Card title="Incognito" description="Three separate switches. Each one does exactly what it says.">
            <div className="flex flex-col gap-4">
              <Switch id="demo-feed" label="Show my bets in the live feed" defaultChecked />
              <Switch id="demo-board" label="Show me on the leaderboard" defaultChecked />
              <Switch id="demo-profile" label="Public profile" description="Anyone with the link can see your stats." />
            </div>
          </Card>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap gap-3">
            <Badge>Neutral</Badge>
            <Badge tone="accent">Provably fair</Badge>
            <Badge tone="win">Won</Badge>
            <Badge tone="loss">Lost</Badge>
            <Badge tone="warn">Session: 90 min</Badge>
            <Badge tone="neutral">18+</Badge>
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid gap-gutter md:grid-cols-3">
            <Card title="Balance" description="Play coins. Worth nothing.">
              <span className="font-mono text-3xl font-bold tabular-nums">{formatCoins(1024)}</span>
            </Card>
            <Card
              title="Dice"
              description="Sample game card. The real house edge goes here once the game exists."
              action={<Badge tone="accent">Original</Badge>}
            />
            <Card title="Glass of water" description="You have been playing ninety minutes.">
              <Button variant="secondary" fullWidth>
                Take a break
              </Button>
            </Card>
          </div>
        </Section>

        <Section title="Table">
          <Table>
            <thead>
              <tr>
                <Th>Rank</Th>
                <Th>Player</Th>
                <Th numeric>Wagered</Th>
                <Th numeric>Bets</Th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row) => (
                <tr key={row.rank} className="hover:bg-surface-hover">
                  <Td numeric className="w-16 text-left!">{row.rank}</Td>
                  <Td>{row.player}</Td>
                  <Td numeric>{formatCoins(row.wagered)}</Td>
                  <Td numeric>{row.bets.toLocaleString("en-US")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Live feed row" note="Wins in green, losses in red, always with a sign. Incognito players show as Incognito.">
          <FeedList bets={feed} />
        </Section>

        <Section title="Bet panel shell" note="The frame every Original sits in. Layout only: these buttons are not connected to anything.">
          <BetPanel
            id="demo-panel"
            controls={
              <Field id="demo-panel-target" label="Game controls go here">
                <Input id="demo-panel-target" numeric defaultValue="50.00" suffix="%" />
              </Field>
            }
            stage={<p className="text-sm text-fg-subtle">The game goes here.</p>}
          />
        </Section>
      </main>
    </div>
  );
}
