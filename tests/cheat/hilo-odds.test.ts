import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { afterRound, startAuto, type AutoSettings } from "../../src/lib/auto-bet";
import { rankOf } from "../../src/lib/hilo";
import {
  COIN,
  WELCOME,
  balance,
  cashOutHilo,
  connect,
  guessHilo,
  ledgerRows,
  newAccount,
  newKey,
  startHilo,
} from "../db/helpers";

// ROADMAP session 08: Hilo gets the same million-round check as the other
// Originals.
//
// Part 1 deals one million rounds with the database's own recipe and hilo
// maths (fair_numbers, hilo_card, hilo_win_count, hilo_is_right,
// hilo_payout, exactly what the hilo functions use), with a fresh random
// secret each run. It skips only the ledger writes. Each round's first
// card is checked against the exact chance of every one of the 52 cards,
// and the same cards are played with six strategies.
//
// Part 2 plays 10,000 real rounds through start_hilo, guess_hilo,
// cash_out_hilo and the ledger, and checks every coin.
//
// Theoretical return: exactly 99% for every strategy. Each right guess pays
// 2^32 / (how many numbers win it), which is exactly fair, and the 1% edge
// is taken once at cash out. Rounding each payout down to the hundredth of
// a coin costs under 0.0001% on a 100-coin bet.
//
// Pass mark: within 4.5 standard errors of the prediction, as for Dice.

const ROUNDS = 1_000_000;
const TOLERANCE = 4.5;
const N = 2 ** 32;
const BIG_N = BigInt(N);

let db: pg.Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

function report(label: string, observed: number, predicted: number, standardError: number, digits = 4) {
  const z = (observed - predicted) / standardError;
  console.log(
    `${label}: ${(observed * 100).toFixed(digits)}% (predicted ${(predicted * 100).toFixed(digits)}%, ` +
      `${z >= 0 ? "+" : ""}${z.toFixed(2)} standard errors)`,
  );
  expect(Math.abs(z), label).toBeLessThan(TOLERANCE);
}

function expectRate(label: string, hits: number, rounds: number, p: number) {
  report(`${label} (${hits.toLocaleString("en-US")})`, hits / rounds, p, Math.sqrt((p * (1 - p)) / rounds));
}

// The exact chances, worked out here from scratch, not from src/lib/hilo.ts.
function ceilDiv(x: bigint, y: bigint): bigint {
  return (x + y - BigInt(1)) / y;
}
function cardChance(card: number): number {
  return Number(ceilDiv(BigInt(card + 1) * BIG_N, BigInt(52)) - ceilDiv(BigInt(card) * BIG_N, BigInt(52))) / N;
}
function rankStart(rank: number): number {
  return Number(ceilDiv(BigInt(rank) * BIG_N, BigInt(13)));
}
function rankChance(rank: number): number {
  return (rankStart(rank + 1) - rankStart(rank)) / N;
}
function winChance(rank: number, guess: "higher" | "lower"): number {
  return guess === "higher" ? (N - rankStart(rank)) / N : rankStart(rank + 1) / N;
}
// The likelier side; on an Ace or a King, the only side allowed.
function likely(rank: number): "higher" | "lower" {
  if (rank === 0) return "lower";
  if (rank === 12) return "higher";
  return winChance(rank, "higher") >= winChance(rank, "lower") ? "higher" : "lower";
}
function unlikely(rank: number): "higher" | "lower" {
  if (rank === 0) return "lower";
  if (rank === 12) return "higher";
  return likely(rank) === "higher" ? "lower" : "higher";
}
function rightFrom(rank: number, guess: "higher" | "lower"): number[] {
  return Array.from({ length: 13 }, (_, s) => s).filter((s) => (guess === "higher" ? s >= rank : s <= rank));
}
const RANKS = Array.from({ length: 13 }, (_, r) => r);
// Chance the likelier side is right once, and twice in a row.
const LIKELY_ONCE = RANKS.reduce((sum, r) => sum + rankChance(r) * winChance(r, likely(r)), 0);
const LIKELY_TWICE = RANKS.reduce(
  (sum, r) => sum + rankChance(r) * rightFrom(r, likely(r)).reduce((t, s) => t + rankChance(s) * winChance(s, likely(s)), 0),
  0,
);
const UNLIKELY_ONCE = RANKS.reduce((sum, r) => sum + rankChance(r) * winChance(r, unlikely(r)), 0);

// One round played with a strategy, using only the database's hilo maths.
// Returns the payout on a 100-coin bet: 0 on a loss.
const SIMULATE = `
create function pg_temp.hilo_play(n double precision[], strategy text, goal int) returns bigint
language plpgsql as $$
declare
  i int := 1;
  r int := public.hilo_card(n[1]) / 4;
  s int;
  g text;
  skips int := 0;
  counts bigint[] := '{}';
begin
  loop
    if strategy = 'skip_ends' and r in (0, 12) and skips < 2 then
      skips := skips + 1;
      i := i + 1;
      r := public.hilo_card(n[i]) / 4;
      continue;
    end if;
    if r = 0 then g := 'lower';
    elsif r = 12 then g := 'higher';
    elsif (strategy = 'unlikely') = (public.hilo_win_count(r, 'higher') >= public.hilo_win_count(r, 'lower')) then g := 'lower';
    else g := 'higher';
    end if;
    i := i + 1;
    s := public.hilo_card(n[i]) / 4;
    if not public.hilo_is_right(r, g, s) then
      return 0;
    end if;
    counts := counts || public.hilo_win_count(r, g);
    if cardinality(counts) = goal then
      return public.hilo_payout(10000, counts);
    end if;
    r := s;
  end loop;
end $$`;

const STRATEGIES = [
  { column: "likely_1", label: "likelier side, cash out after 1", strategy: "likely", goal: 1, wins: LIKELY_ONCE },
  { column: "likely_2", label: "likelier side, cash out after 2", strategy: "likely", goal: 2, wins: LIKELY_TWICE },
  { column: "likely_3", label: "likelier side, cash out after 3", strategy: "likely", goal: 3, wins: null },
  { column: "likely_5", label: "likelier side, cash out after 5", strategy: "likely", goal: 5, wins: null },
  { column: "unlikely_1", label: "unlikelier side, cash out after 1", strategy: "unlikely", goal: 1, wins: UNLIKELY_ONCE },
  { column: "skip_ends_2", label: "skip Aces and Kings, then 2", strategy: "skip_ends", goal: 2, wins: null },
];

describe("hilo: one million rounds", () => {
  it(
    "deals every card as often as the maths says and pays back 99% whatever the strategy",
    async () => {
      const secret = randomBytes(32).toString("hex");
      const word = `odds-${randomBytes(4).toString("hex")}`;
      console.log(`secret ${secret}, word ${word}`);

      // Eight fair numbers per round (one HMAC block): enough for every
      // strategy here, which uses at most six cards.
      await db.query("drop table if exists pg_temp.million");
      let started = Date.now();
      await db.query(
        `create temporary table million as
         select s.spin, public.fair_numbers($1, $2, s.spin, 8) as n
         from generate_series(0, $3 - 1) as s(spin)`,
        [secret, word, ROUNDS],
      );
      console.log(`dealt ${ROUNDS.toLocaleString("en-US")} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

      // Every card from 0 to 51, as the first card of a round.
      const { rows: firsts } = await db.query(
        "select public.hilo_card(n[1]) as card, count(*)::int as n from million group by 1 order by 1",
      );
      expect(firsts.map((r) => r.card)).toEqual(Array.from({ length: 52 }, (_, c) => c));
      for (const row of firsts) expectRate(`card ${row.card}`, row.n, ROUNDS, cardChance(row.card));

      // Play every round with every strategy.
      await db.query(SIMULATE);
      started = Date.now();
      await db.query("drop table if exists pg_temp.plays");
      await db.query(
        `create temporary table plays as select ${STRATEGIES.map(
          (s) => `pg_temp.hilo_play(n, '${s.strategy}', ${s.goal}) as ${s.column}`,
        ).join(", ")} from million`,
      );
      console.log(`played them ${STRATEGIES.length} ways in ${((Date.now() - started) / 1000).toFixed(1)} s`);

      for (const s of STRATEGIES) {
        const { rows } = await db.query(
          `select count(*) filter (where ${s.column} > 0)::int as wins,
                  avg(${s.column})::float8 as mean, stddev_pop(${s.column})::float8 as sd
           from plays`,
        );
        const { wins, mean, sd } = rows[0];
        if (s.wins !== null) expectRate(`${s.label}: right`, wins, ROUNDS, s.wins);
        // Paid back per coin bet, against exactly 99%.
        report(`${s.label}: paid back`, mean / 10000, 0.99, sd / 10000 / Math.sqrt(ROUNDS), 3);
      }
    },
    900_000,
  );
});

describe("hilo: 10,000 real rounds through the ledger", () => {
  it(
    "wins at the predicted rate and every coin adds up",
    async () => {
      const player = await newAccount(db);
      const settings: AutoSettings = {
        baseAmount: COIN,
        onWin: { kind: "reset" },
        onLoss: { kind: "reset" },
        stopWhenUpBy: null,
        stopWhenDownBy: null,
        bets: 10_000,
      };

      // Likelier side twice, then cash out. Only the cards the server has
      // handed back are used: no peeking here.
      let state = startAuto(settings);
      let wins = 0;
      let staked = 0;
      let paid = 0;
      let stop = null;
      let lastBalance = WELCOME;
      while (!stop) {
        let round = await startHilo(db, player, state.amount, newKey());
        while (round.state === "open" && round.guesses.length < 2) {
          const guess = likely(rankOf(round.cards.at(-1)!));
          round = await guessHilo(db, player, round.roundId, round.guesses.length + 1, guess, newKey());
        }
        if (round.state === "open") round = await cashOutHilo(db, player, round.roundId, newKey());
        if (round.payout > 0) wins++;
        staked += state.amount;
        paid += round.payout;
        lastBalance = round.balance;
        ({ state, stop } = afterRound(settings, state, { amount: state.amount, payout: round.payout }, round.balance));
      }

      expect(stop).toBe("count");
      expect(state.betsPlaced).toBe(10_000);
      expectRate("likelier side, cash out after 2", wins, 10_000, LIKELY_TWICE);

      // Every coin: the welcome grant, minus every bet, plus every payout.
      expect(state.net).toBe(paid - staked);
      expect(lastBalance).toBe(WELCOME - staked + paid);
      expect(await balance(db, player)).toBe(WELCOME - staked + paid);
      const lines = await ledgerRows(db, player);
      expect(lines.filter((l) => l.kind === "bet")).toHaveLength(10_000);
      expect(lines.filter((l) => l.kind === "payout")).toHaveLength(wins);
    },
    900_000,
  );
});
