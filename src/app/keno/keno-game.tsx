"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BetPanel, type BetOutcome } from "../../components/ui/bet-panel";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { formatSignedUnits, formatUnits } from "../../components/ui/format";
import { Table, Td, Th } from "../../components/ui/table";
import { MAX_PICKS, NUMBERS, PAYTABLE, hitChance, returnPercent } from "../../lib/keno";
import type { SeedStatus } from "../../lib/seeds";
import type { KenoRound } from "../../lib/wallet";
import { playKenoAction } from "./actions";

// Draws the board and shows whatever the server sent back. The draw, the
// hits and the payout all come from playKenoAction; nothing here decides one.

type Played = KenoRound & { amount: number; picks: number[] };

const times = (h: number) => `${(h / 100).toFixed(2)}×`;

function formatChance(p: number): string {
  const percent = p * 100;
  return percent >= 0.01 ? `${percent.toFixed(2)}%` : `${percent.toPrecision(2)}%`;
}

export function KenoGame({ initialBalance, seeds }: { initialBalance: number; seeds: SeedStatus }) {
  const [balance, setBalance] = useState(initialBalance);
  const [picks, setPicks] = useState<number[]>([]);
  const [rounds, setRounds] = useState<Played[]>([]);
  const [lossStreak, setLossStreak] = useState(0);
  const [locked, setLocked] = useState(false);

  const last = rounds[0];
  // The last draw is shown only while the picks it was played with are still up.
  const showDraw = last && last.picks.length === picks.length && last.picks.every((p) => picks.includes(p));
  const drawn = new Set(showDraw ? last.drawn : []);

  function toggle(n: number) {
    if (locked) return;
    setPicks((ps) => (ps.includes(n) ? ps.filter((p) => p !== n) : ps.length < MAX_PICKS ? [...ps, n] : ps));
  }

  const onBet = useCallback(
    async (amount: number): Promise<BetOutcome> => {
      const result = await playKenoAction({ amount, picks, key: crypto.randomUUID() });
      if (!result.ok) return { ok: false, error: result.error };
      const round = result.round;
      setBalance(round.balance);
      setRounds((rs) => [{ ...round, amount, picks }, ...rs].slice(0, 20));
      setLossStreak((n) => (round.won ? 0 : n + 1));
      return { ok: true, bet: { amount, payout: round.payout, balance: round.balance } };
    },
    [picks],
  );

  const nextSpin = last ? last.spin + 1 : seeds.nextSpin;
  const count = picks.length;

  return (
    <div className="flex flex-col gap-gutter">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-fg-muted">Balance</span>
        <span className="font-mono text-2xl font-bold tabular-nums" data-testid="balance">
          {formatUnits(balance)}
        </span>
      </div>

      <BetPanel
        id="keno"
        onBet={onBet}
        onRunningChange={setLocked}
        controls={
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-fg">
                Picked <span className="font-mono tabular-nums">{count}</span> of {MAX_PICKS}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setPicks([])} disabled={locked || count === 0}>
                Clear picks
              </Button>
            </div>
            {count > 0 ? (
              <div className="flex flex-col gap-1">
                <Table>
                  <thead>
                    <tr>
                      <Th numeric>Hits</Th>
                      <Th numeric>Pays</Th>
                      <Th numeric>Chance</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {PAYTABLE[count]
                      .map((m, hits) => ({ m, hits }))
                      .reverse()
                      .map(({ m, hits }) => (
                        <tr key={hits} className={showDraw && last.hits === hits ? "bg-accent-soft" : undefined}>
                          <Td numeric>{hits}</Td>
                          <Td numeric>{times(m)}</Td>
                          <Td numeric>{formatChance(hitChance(count, hits))}</Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
                <p className="text-xs text-fg-muted">
                  Pays back {returnPercent(count).toFixed(3)}% on average. House edge{" "}
                  {(100 - returnPercent(count)).toFixed(3)}%.
                </p>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Pick numbers on the board to see what they pay.</p>
            )}
          </div>
        }
        stage={
          <div className="flex w-full max-w-xl flex-col gap-6">
            <div
              className="grid grid-cols-8 gap-1.5"
              role="group"
              aria-label={`Keno board, ${count} of ${MAX_PICKS} picked`}
            >
              {Array.from({ length: NUMBERS }, (_, i) => i + 1).map((n) => {
                const picked = picks.includes(n);
                const hit = picked && drawn.has(n);
                const tone = hit
                  ? "bg-win text-bg border-win"
                  : picked
                    ? drawn.size > 0
                      ? "bg-accent-soft text-fg border-loss"
                      : "bg-accent text-accent-fg border-accent"
                    : drawn.has(n)
                      ? "bg-surface-hover text-fg border-border-strong"
                      : "bg-inset text-fg-muted border-border";
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggle(n)}
                    disabled={locked || (!picked && count >= MAX_PICKS)}
                    aria-pressed={picked}
                    aria-label={`${n}${picked ? ", picked" : ""}${drawn.has(n) ? ", drawn" : ""}`}
                    className={`aspect-square rounded-sm border font-mono text-sm tabular-nums transition-colors enabled:hover:border-border-strong disabled:cursor-not-allowed ${tone}`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>

            <div className="text-center" aria-live="polite">
              <p
                className={`font-mono text-4xl font-bold tabular-nums ${showDraw ? (last.won ? "text-win" : "text-loss") : "text-fg-subtle"}`}
                data-testid="multiplier"
              >
                {showDraw ? times(last.multiplier) : "—"}
              </p>
              <p className="mt-2 min-h-5 text-sm text-fg-muted">
                {showDraw
                  ? resultLine(last, lossStreak)
                  : count === 0
                    ? "Pick up to ten numbers."
                    : `${count} picked. Ten will be drawn.`}
              </p>
            </div>
          </div>
        }
      />

      {rounds.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-fg">This visit</h2>
          <Table>
            <thead>
              <tr>
                <Th numeric>Spin</Th>
                <Th numeric>Bet</Th>
                <Th numeric>Hits</Th>
                <Th numeric>Paid</Th>
                <Th numeric>Net</Th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.roundId}>
                  <Td numeric>{r.spin}</Td>
                  <Td numeric>{formatUnits(r.amount)}</Td>
                  <Td numeric>
                    {r.hits} / {r.picks.length}
                  </Td>
                  <Td numeric>{times(r.multiplier)}</Td>
                  <Td numeric className={r.payout > r.amount ? "text-win" : "text-loss"}>
                    {formatSignedUnits(r.payout - r.amount)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}

      <Card
        title="Check any draw"
        description="The draw uses the spin's first 10 numbers. Each one picks from the numbers still left, lowest first: position = number × how many are left, rounded down. Retire your secret on your account page, then paste it into the checker with your word and the spin number."
      >
        <dl className="grid gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="text-fg-muted">Live secret’s fingerprint</dt>
            <dd className="font-mono break-all text-fg">{seeds.fingerprint}</dd>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="flex flex-col gap-1">
              <dt className="text-fg-muted">Client word</dt>
              <dd className="font-mono break-all text-fg">{seeds.clientWord}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-fg-muted">Next spin</dt>
              <dd className="font-mono tabular-nums text-fg">{nextSpin}</dd>
            </div>
          </div>
        </dl>
        <p className="text-sm text-fg-muted">
          <Link href="/account" className="text-accent-text hover:underline">Change word and reveal secret</Link>
          {" · "}
          <Link href="/fairness" className="text-accent-text hover:underline">Open the checker</Link>
        </p>
      </Card>
    </div>
  );
}

function resultLine(round: Played, lossStreak: number): string {
  const of = `${round.hits} of ${round.picks.length}`;
  if (round.payout === 0 && lossStreak >= 5) return `${of} hit. Nothing paid, ${lossStreak} rounds running.`;
  if (round.payout === 0) return `${of} hit. That line pays nothing.`;
  if (round.payout < round.amount) return `${of} hit. Paid ${formatUnits(round.payout)}, less than the bet. Still a loss.`;
  const chance = formatChance(hitChance(round.picks.length, round.hits));
  return `${of} hit. Paid ${formatUnits(round.payout)}. That happens ${chance} of the time, for the record.`;
}
