"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BetPanel, type BetOutcome } from "../../components/ui/bet-panel";
import { Card } from "../../components/ui/card";
import { formatSignedUnits, formatUnits, parseCoins } from "../../components/ui/format";
import { Field, Input } from "../../components/ui/input";
import { Table, Td, Th } from "../../components/ui/table";
import { MAX_TARGET, MIN_TARGET, profitOnWin, winChancePercent } from "../../lib/limbo";
import type { SeedStatus } from "../../lib/seeds";
import type { LimboRound } from "../../lib/wallet";
import { playLimboAction } from "./actions";

// Draws the game and shows whatever the server sent back. The result, the
// win and the payout all come from playLimboAction; nothing here decides one.

type Played = LimboRound & { amount: number; target: number };

const multiplierFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Hundredths of a multiplier, shown as "2.00×".
const times = (h: number) => `${multiplierFormat.format(h / 100)}×`;

// Win chances run from 98% down to 0.000099%, so small ones get more digits.
function formatChance(percent: number): string {
  return percent >= 0.01 ? percent.toFixed(2) : percent.toPrecision(2);
}

// A typed win chance (hundredths of a percent) becomes the target that pays
// 99 / chance, pulled back inside 1.01x to 1,000,000x.
function targetForChance(chance: number): number {
  return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.floor(990_000 / chance)));
}

export function LimboGame({ initialBalance, seeds }: { initialBalance: number; seeds: SeedStatus }) {
  const [balance, setBalance] = useState(initialBalance);
  const [target, setTarget] = useState(200);
  const [targetText, setTargetText] = useState("2.00");
  const [chanceText, setChanceText] = useState("49.50");
  const [rounds, setRounds] = useState<Played[]>([]);
  const [lossStreak, setLossStreak] = useState(0);
  const [locked, setLocked] = useState(false);

  const chance = winChancePercent(target);
  const valid = chance !== null;
  const last = rounds[0];

  function typeTarget(text: string) {
    setTargetText(text);
    const t = parseCoins(text);
    if (t === null) return;
    setTarget(t);
    const c = winChancePercent(t);
    if (c !== null) setChanceText(formatChance(c));
  }

  function typeChance(text: string) {
    setChanceText(text);
    const c = parseCoins(text);
    if (c === null || c <= 0) return;
    const t = targetForChance(c);
    setTarget(t);
    setTargetText((t / 100).toFixed(2));
  }

  const onBet = useCallback(
    async (amount: number): Promise<BetOutcome> => {
      const result = await playLimboAction({ amount, target, key: crypto.randomUUID() });
      if (!result.ok) return { ok: false, error: result.error };
      const round = result.round;
      setBalance(round.balance);
      setRounds((rs) => [{ ...round, amount, target }, ...rs].slice(0, 20));
      setLossStreak((n) => (round.won ? 0 : n + 1));
      return { ok: true, bet: { amount, payout: round.payout, balance: round.balance } };
    },
    [target],
  );

  const nextSpin = last ? last.spin + 1 : seeds.nextSpin;

  return (
    <div className="flex flex-col gap-gutter">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-fg-muted">Balance</span>
        <span className="font-mono text-2xl font-bold tabular-nums" data-testid="balance">
          {formatUnits(balance)}
        </span>
      </div>

      <BetPanel
        id="limbo"
        onBet={onBet}
        profitOnWin={(amount) => profitOnWin(amount, target)}
        onRunningChange={setLocked}
        controls={
          <div className="grid grid-cols-2 gap-2">
            <Field id="limbo-target" label="Target" error={valid ? undefined : "1.01× to 1,000,000×."}>
              <Input
                id="limbo-target"
                numeric
                inputMode="decimal"
                value={targetText}
                onChange={(e) => typeTarget(e.target.value)}
                onBlur={() => valid && setTargetText((target / 100).toFixed(2))}
                suffix="×"
                invalid={!valid}
                disabled={locked}
              />
            </Field>
            <Field id="limbo-chance" label="Win chance">
              <Input
                id="limbo-chance"
                numeric
                inputMode="decimal"
                value={chanceText}
                onChange={(e) => typeChance(e.target.value)}
                onBlur={() => chance !== null && setChanceText(formatChance(chance))}
                suffix="%"
                disabled={locked}
              />
            </Field>
          </div>
        }
        stage={
          <div className="flex w-full max-w-xl flex-col gap-6">
            <div className="text-center" aria-live="polite">
              <p
                className={`font-mono text-4xl font-bold tabular-nums break-all ${last ? (last.won ? "text-win" : "text-loss") : "text-fg-subtle"}`}
                data-testid="result"
              >
                {last ? times(last.result) : "—"}
              </p>
              <p className="mt-2 min-h-5 text-sm text-fg-muted">
                {last ? resultLine(last, lossStreak) : `Needs ${times(target)} or more to win.`}
              </p>
            </div>

            {rounds.length > 0 ? (
              <ol className="flex flex-wrap justify-center gap-1" aria-label="Last results">
                {rounds.slice(0, 12).map((r) => (
                  <li
                    key={r.roundId}
                    className={`rounded-sm px-2 py-0.5 font-mono text-xs tabular-nums ${r.won ? "bg-win-soft text-win" : "bg-loss-soft text-loss"}`}
                  >
                    {times(r.result)}
                  </li>
                ))}
              </ol>
            ) : null}
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
                <Th numeric>Target</Th>
                <Th numeric>Result</Th>
                <Th numeric>Net</Th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.roundId}>
                  <Td numeric>{r.spin}</Td>
                  <Td numeric>{formatUnits(r.amount)}</Td>
                  <Td numeric>{times(r.target)}</Td>
                  <Td numeric>{times(r.result)}</Td>
                  <Td numeric className={r.won ? "text-win" : "text-loss"}>
                    {formatSignedUnits(r.payout - r.amount)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}

      <Card
        title="Check any result"
        description="Each result is 99 × 2³² ÷ (2³² − k), rounded down to 0.01×, where k is the spin's first number × 2³². Retire your secret on your account page, then paste it into the checker with your word and the spin number."
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
  const chance = formatChance(winChancePercent(round.target)!);
  if (round.won) return `Won ${formatUnits(round.payout)}. It was a ${chance}% chance, for the record.`;
  if (lossStreak >= 5) return `Lost. That is ${lossStreak} in a row at ${chance}% each. It happens more than people think.`;
  return `Lost. Needed ${times(round.target)}.`;
}
