"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BetPanel, type BetOutcome } from "../../components/ui/bet-panel";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { formatSignedUnits, formatUnits, parseCoins } from "../../components/ui/format";
import { Field, Input } from "../../components/ui/input";
import { Table, Td, Th } from "../../components/ui/table";
import {
  MAX_WINNING_ROLLS,
  MIN_WINNING_ROLLS,
  flipTarget,
  multiplier,
  profitOnWin,
  winChancePercent,
  winningRolls,
  type DiceDirection,
} from "../../lib/dice";
import type { SeedStatus } from "../../lib/seeds";
import type { DiceRound } from "../../lib/wallet";
import { playDiceAction } from "./actions";

// Draws the game and animates whatever the server sent back. The roll, the
// win and the payout all come from playDiceAction; nothing here decides one.

type Played = DiceRound & { amount: number; target: number; direction: DiceDirection };

const hundredths = (n: number) => (n / 100).toFixed(2);

// The target the slider or a typed win chance asks for, pulled back inside
// 0.01% to 98% for the current direction.
function clampTarget(target: number, direction: DiceDirection): number {
  const [lo, hi] =
    direction === "under" ? [MIN_WINNING_ROLLS, MAX_WINNING_ROLLS] : [9_999 - MAX_WINNING_ROLLS, 9_999 - MIN_WINNING_ROLLS];
  return Math.min(hi, Math.max(lo, target));
}

export function DiceGame({ initialBalance, seeds }: { initialBalance: number; seeds: SeedStatus }) {
  const [balance, setBalance] = useState(initialBalance);
  const [direction, setDirection] = useState<DiceDirection>("under");
  const [target, setTarget] = useState(4950);
  const [targetText, setTargetText] = useState("49.50");
  const [chanceText, setChanceText] = useState("49.50");
  const [rounds, setRounds] = useState<Played[]>([]);
  const [lossStreak, setLossStreak] = useState(0);
  const [locked, setLocked] = useState(false);

  const valid = winningRolls(target, direction) !== null;
  const last = rounds[0];

  const applyTarget = useCallback((t: number, d: DiceDirection) => {
    setTarget(t);
    setTargetText(hundredths(t));
    const chance = winChancePercent(t, d);
    if (chance !== null) setChanceText(chance.toFixed(2));
  }, []);

  const flip = useCallback(() => {
    const d = direction === "under" ? "over" : "under";
    setDirection(d);
    applyTarget(flipTarget(target), d);
  }, [direction, target, applyTarget]);

  function typeTarget(text: string) {
    setTargetText(text);
    const t = parseCoins(text);
    if (t === null) return;
    setTarget(t);
    const chance = winChancePercent(t, direction);
    if (chance !== null) setChanceText(chance.toFixed(2));
  }

  function typeChance(text: string) {
    setChanceText(text);
    const rolls = parseCoins(text);
    if (rolls === null || rolls < MIN_WINNING_ROLLS || rolls > MAX_WINNING_ROLLS) return;
    const t = direction === "under" ? rolls : 9_999 - rolls;
    setTarget(t);
    setTargetText(hundredths(t));
  }

  const onBet = useCallback(
    async (amount: number): Promise<BetOutcome> => {
      const result = await playDiceAction({ amount, target, direction, key: crypto.randomUUID() });
      if (!result.ok) return { ok: false, error: result.error };
      const round = result.round;
      setBalance(round.balance);
      setRounds((rs) => [{ ...round, amount, target, direction }, ...rs].slice(0, 20));
      setLossStreak((n) => (round.won ? 0 : n + 1));
      return { ok: true, bet: { amount, payout: round.payout, balance: round.balance } };
    },
    [target, direction],
  );

  const chance = winChancePercent(target, direction);
  const x = multiplier(target, direction);
  const nextSpin = last ? last.spin + 1 : seeds.nextSpin;

  // Win zone on the track, as percentages of its width.
  const winFrom = direction === "under" ? 0 : (target + 1) / 100;
  const winTo = direction === "under" ? target / 100 : 100;

  return (
    <div className="flex flex-col gap-gutter">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-fg-muted">Balance</span>
        <span className="font-mono text-2xl font-bold tabular-nums" data-testid="balance">
          {formatUnits(balance)}
        </span>
      </div>

      <BetPanel
        id="dice"
        onBet={onBet}
        profitOnWin={(amount) => profitOnWin(amount, target, direction)}
        shortcuts={{ d: { label: "flip over/under", run: flip } }}
        onRunningChange={setLocked}
        controls={
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Field
                id="dice-target"
                label={direction === "under" ? "Roll under" : "Roll over"}
                error={valid ? undefined : "Out of range."}
              >
                <Input
                  id="dice-target"
                  numeric
                  inputMode="decimal"
                  value={targetText}
                  onChange={(e) => typeTarget(e.target.value)}
                  onBlur={() => valid && setTargetText(hundredths(target))}
                  invalid={!valid}
                  disabled={locked}
                />
              </Field>
              <Field id="dice-chance" label="Win chance">
                <Input
                  id="dice-chance"
                  numeric
                  inputMode="decimal"
                  value={chanceText}
                  onChange={(e) => typeChance(e.target.value)}
                  onBlur={() => chance !== null && setChanceText(chance.toFixed(2))}
                  suffix="%"
                  disabled={locked}
                />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">
                Pays <span className="font-mono tabular-nums text-fg">{x === null ? "—" : `${x.toFixed(4)}×`}</span>
              </span>
              <Button variant="secondary" size="sm" onClick={flip} disabled={locked}>
                Flip to roll {direction === "under" ? "over" : "under"} (D)
              </Button>
            </div>
          </div>
        }
        stage={
          <div className="flex w-full max-w-xl flex-col gap-6">
            <div className="text-center" aria-live="polite">
              <p
                className={`font-mono text-4xl font-bold tabular-nums ${last ? (last.won ? "text-win" : "text-loss") : "text-fg-subtle"}`}
                data-testid="roll"
              >
                {last ? hundredths(last.roll) : "—"}
              </p>
              <p className="mt-2 min-h-5 text-sm text-fg-muted">
                {last ? resultLine(last, lossStreak) : `Roll ${direction} ${hundredths(target)} to win.`}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="relative h-3 rounded-full bg-loss-soft">
                <div
                  className="absolute inset-y-0 rounded-full bg-win-soft ring-1 ring-win"
                  style={{ left: `${winFrom}%`, width: `${Math.max(0, winTo - winFrom)}%` }}
                />
                {last ? (
                  <div
                    className={`absolute -top-1.5 size-6 -translate-x-1/2 rounded-full border-2 border-bg transition-[left] duration-300 ${last.won ? "bg-win" : "bg-loss"}`}
                    style={{ left: `${last.roll / 100}%` }}
                    aria-hidden
                  />
                ) : null}
              </div>
              <input
                type="range"
                min={0}
                max={9999}
                value={target}
                onChange={(e) => applyTarget(clampTarget(Number(e.target.value), direction), direction)}
                disabled={locked}
                aria-label="Target"
                className="w-full accent-accent"
              />
              <div className="flex justify-between font-mono text-xs tabular-nums text-fg-subtle">
                <span>0</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>
            </div>

            {rounds.length > 0 ? (
              <ol className="flex flex-wrap justify-center gap-1" aria-label="Last rolls">
                {rounds.slice(0, 12).map((r) => (
                  <li
                    key={r.roundId}
                    className={`rounded-sm px-2 py-0.5 font-mono text-xs tabular-nums ${r.won ? "bg-win-soft text-win" : "bg-loss-soft text-loss"}`}
                  >
                    {hundredths(r.roll)}
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
                <Th>Needed</Th>
                <Th numeric>Roll</Th>
                <Th numeric>Net</Th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.roundId}>
                  <Td numeric>{r.spin}</Td>
                  <Td numeric>{formatUnits(r.amount)}</Td>
                  <Td>
                    {r.direction} {hundredths(r.target)}
                  </Td>
                  <Td numeric>{hundredths(r.roll)}</Td>
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
        title="Check any roll"
        description="Each roll is the spin's first number × 10,000, rounded down, read as hundredths. Retire your secret on your account page, then paste it into the checker with your word and the spin number."
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
  const chance = winChancePercent(round.target, round.direction)!.toFixed(2);
  if (round.won) return `Won ${formatUnits(round.payout)}. It was a ${chance}% chance, for the record.`;
  if (lossStreak >= 5) return `Lost. That is ${lossStreak} in a row at ${chance}% each. It happens more than people think.`;
  return `Lost. Needed ${round.direction} ${hundredths(round.target)}.`;
}
