"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BetPanel, type BetOutcome } from "../../components/ui/bet-panel";
import { Card } from "../../components/ui/card";
import { formatSignedUnits, formatUnits } from "../../components/ui/format";
import { SegmentedControl } from "../../components/ui/input";
import { Table, Td, Th } from "../../components/ui/table";
import type { SeedStatus } from "../../lib/seeds";
import type { WheelRound } from "../../lib/wallet";
import { SEGMENTS, WHEELS, isWheelRisk, payTable, type WheelRisk } from "../../lib/wheel";
import { playWheelAction } from "./actions";

// Draws the wheel and turns it to whatever segment the server sent back.
// The segment, the multiplier and the payout all come from playWheelAction;
// the spin animation only follows them.

type Played = WheelRound & { amount: number; risk: WheelRisk };

const SLICE = 360 / SEGMENTS;
// How long the wheel turns. The result is already settled on the server
// before it starts; this only decides when it is shown.
const SPIN_MS = 1200;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
const times = (h: number) => `${(h / 100).toFixed(2)}×`;

// Fill for a segment: dark pays nothing, blue pays something, brighter blue
// pays 2x or more. Win and loss colours are kept for the result itself.
function fill(multiplier: number): string {
  if (multiplier === 0) return "fill-inset";
  if (multiplier >= 200) return "fill-accent";
  return "fill-accent/50";
}

// One wedge, clockwise from the top, on a 200 x 200 board.
function wedge(segment: number): string {
  const r = 96;
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(100 + r * Math.sin(rad)).toFixed(3)} ${(100 - r * Math.cos(rad)).toFixed(3)}`;
  };
  return `M 100 100 L ${point(segment * SLICE)} A ${r} ${r} 0 0 1 ${point((segment + 1) * SLICE)} Z`;
}

export function WheelGame({ initialBalance, seeds }: { initialBalance: number; seeds: SeedStatus }) {
  const [balance, setBalance] = useState(initialBalance);
  const [risk, setRisk] = useState<WheelRisk>("medium");
  const [rounds, setRounds] = useState<Played[]>([]);
  const [lossStreak, setLossStreak] = useState(0);
  const [locked, setLocked] = useState(false);
  // How far the wheel has turned, in degrees. Only ever grows, so every spin
  // goes forwards.
  const [turn, setTurn] = useState(0);
  // True while the wheel is turning towards a result that isn't shown yet.
  const [spinning, setSpinning] = useState(false);

  const last = rounds[0];
  // The wheel always shows the chosen risk level; the last landing is marked
  // only while it is still the same wheel.
  const shownRisk = risk;
  const table = WHEELS[shownRisk];
  // The segment to outline: the last landing, once the wheel has stopped on it.
  const marked = !spinning && last && last.risk === shownRisk ? last.segment : null;

  const onBet = useCallback(
    async (amount: number): Promise<BetOutcome> => {
      const result = await playWheelAction({ amount, risk, key: crypto.randomUUID() });
      if (!result.ok) return { ok: false, error: result.error };
      const round = result.round;
      // Four full turns, then stop with the landed segment's middle under the
      // pointer. The result, balance and history wait until it stops.
      setSpinning(true);
      setTurn((t) => {
        const stop = 360 - (round.segment * SLICE + SLICE / 2);
        const base = Math.ceil(t / 360) * 360 + 4 * 360;
        return base + stop;
      });
      if (!reducedMotion()) await new Promise((resolve) => setTimeout(resolve, SPIN_MS));
      setSpinning(false);
      setBalance(round.balance);
      setRounds((rs) => [{ ...round, amount, risk }, ...rs].slice(0, 20));
      setLossStreak((n) => (round.won ? 0 : n + 1));
      return { ok: true, bet: { amount, payout: round.payout, balance: round.balance } };
    },
    [risk],
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
        id="wheel"
        onBet={onBet}
        onRunningChange={setLocked}
        controls={
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-fg">Risk</span>
            <SegmentedControl
              name="wheel-risk"
              label="Risk"
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
              value={risk}
              onChange={(v) => isWheelRisk(v) && setRisk(v)}
              disabled={locked}
            />
          </div>
        }
        stage={
          <div className="flex w-full max-w-xl flex-col items-center gap-6">
            <div className="relative w-full max-w-72">
              {/* The pointer, fixed at the top. */}
              <div
                className="absolute left-1/2 top-0 z-10 size-0 -translate-x-1/2 -translate-y-1 border-x-8 border-t-[14px] border-x-transparent border-t-fg"
                aria-hidden
              />
              <svg
                viewBox="0 0 200 200"
                className="w-full transition-transform duration-[1200ms] ease-out motion-reduce:transition-none"
                style={{ transform: `rotate(${turn}deg)` }}
                role="img"
                aria-label={`A wheel of ${SEGMENTS} segments, ${shownRisk} risk`}
              >
                {table.map((m, i) => (
                  <path
                    key={i}
                    d={wedge(i)}
                    className={`${fill(m)} stroke-bg ${marked === i ? (last!.won ? "stroke-win" : "stroke-loss") : ""}`}
                    strokeWidth={marked === i ? 2.5 : 0.75}
                  />
                ))}
                <circle cx="100" cy="100" r="30" className="fill-surface stroke-border" strokeWidth="1" />
              </svg>
            </div>

            <div className="text-center" aria-live="polite">
              <p
                className={`font-mono text-4xl font-bold tabular-nums ${last && !spinning ? (last.won ? "text-win" : "text-loss") : "text-fg-subtle"}`}
                data-testid="multiplier"
              >
                {last && !spinning ? times(last.multiplier) : "—"}
              </p>
              <p className="mt-2 min-h-5 text-sm text-fg-muted">
                {spinning ? "Spinning…" : last ? resultLine(last, lossStreak) : riskLine(risk)}
              </p>
            </div>

            <ul className="grid w-full grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3" aria-label={`${risk} risk wheel`}>
              {payTable(risk).map(({ multiplier, segments }) => (
                <li key={multiplier} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <svg viewBox="0 0 10 10" className="size-3" aria-hidden>
                      <rect width="10" height="10" rx="2" className={`${fill(multiplier)} stroke-border`} />
                    </svg>
                    <span className="font-mono tabular-nums text-fg">{times(multiplier)}</span>
                  </span>
                  <span className="font-mono tabular-nums text-fg-muted">{segments}/30</span>
                </li>
              ))}
            </ul>
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
                <Th>Risk</Th>
                <Th numeric>Segment</Th>
                <Th numeric>Paid</Th>
                <Th numeric>Net</Th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.roundId}>
                  <Td numeric>{r.spin}</Td>
                  <Td numeric>{formatUnits(r.amount)}</Td>
                  <Td>{r.risk}</Td>
                  <Td numeric>{r.segment}</Td>
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
        title="Check any spin"
        description="The segment is the spin's first number × 30, rounded down: 0 is at the pointer, counting clockwise. Retire your secret on your account page, then paste it into the checker with your word and the spin number."
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

function riskLine(risk: WheelRisk): string {
  const zeros = WHEELS[risk].filter((m) => m === 0).length;
  return `${zeros} of 30 segments pay nothing on ${risk}.`;
}

function resultLine(round: Played, lossStreak: number): string {
  if (round.payout === 0 && lossStreak >= 5) {
    return `Nothing. That is ${lossStreak} in a row. ${riskLine(round.risk)}`;
  }
  if (round.payout === 0) return `Nothing. ${riskLine(round.risk)}`;
  if (round.payout < round.amount) return `Paid ${formatUnits(round.payout)}, less than the bet. That counts as a win here, technically.`;
  const share = WHEELS[round.risk].filter((m) => m === round.multiplier).length;
  return `Paid ${formatUnits(round.payout)}. That multiplier is ${share} of 30 segments, for the record.`;
}
