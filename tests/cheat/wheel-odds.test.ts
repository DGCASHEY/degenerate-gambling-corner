import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { afterRound, startAuto, type AutoSettings } from "../../src/lib/auto-bet";
import { WHEELS, payTable, type WheelRisk } from "../../src/lib/wheel";
import { COIN, WELCOME, balance, connect, ledgerRows, newAccount, newKey, playWheel } from "../db/helpers";

// ROADMAP session 07: Wheel gets the same million-round check as Dice.
//
// Part 1 lands one million spins with the database's own recipe and wheel
// maths (fair_numbers, wheel_segment, wheel_payout, exactly what play_wheel
// uses), with a fresh random secret each run, and scores every landing on
// all three risk levels. It skips only the ledger writes.
//
// Part 2 plays 10,000 real auto bets through play_wheel and the ledger,
// driven by the same auto-bet rules the page uses, and checks every coin.
//
// Theoretical house edge: exactly 1% on every risk level. Each table's 30
// multipliers add up to 99 x 30, and each segment is 1 in 30.
//
// Pass mark: within 4.5 standard errors of the prediction, as for Dice.

const ROUNDS = 1_000_000;
const TOLERANCE = 4.5;

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

// Within TOLERANCE standard errors of the predicted rate?
function expectRate(label: string, hits: number, rounds: number, p: number) {
  report(`${label} (${hits.toLocaleString("en-US")})`, hits / rounds, p, Math.sqrt((p * (1 - p)) / rounds));
}

describe("wheel: one million spins", () => {
  it(
    "lands on every segment equally and pays back 99% on every risk level",
    async () => {
      const secret = randomBytes(32).toString("hex");
      const word = `odds-${randomBytes(4).toString("hex")}`;
      console.log(`secret ${secret}, word ${word}`);

      // Every landing, once, into a temporary table.
      await db.query("drop table if exists pg_temp.million");
      const started = Date.now();
      await db.query(
        `create temporary table million as
         select s.spin, public.wheel_segment((public.fair_numbers($1, $2, s.spin, 1))[1]) as segment
         from generate_series(0, $3 - 1) as s(spin)`,
        [secret, word, ROUNDS],
      );
      console.log(`landed ${ROUNDS.toLocaleString("en-US")} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

      // Every segment equally often: 30 buckets, 29 degrees of freedom.
      const { rows: buckets } = await db.query(
        "select segment, count(*)::int as n from million group by 1 order by 1",
      );
      expect(buckets.map((r) => r.segment)).toEqual(Array.from({ length: 30 }, (_, i) => i));
      const expected = ROUNDS / 30;
      const chiSquare = buckets.reduce((sum, r) => sum + (r.n - expected) ** 2 / expected, 0);
      console.log(`evenness (chi-square, 29 degrees of freedom): ${chiSquare.toFixed(1)} (expected about 29, fail above 70)`);
      expect(chiSquare).toBeLessThan(70);

      for (const risk of ["low", "medium", "high"] as WheelRisk[]) {
        // Bet 100 coins on every landing, with the database's own payout.
        const { rows } = await db.query(
          `select m, count(*)::bigint as n, sum(p)::bigint as paid
           from (select public.wheel_multiplier($1, segment) as m,
                        public.wheel_payout($2, $1, segment) as p from million) t
           group by m`,
          [risk, 100 * COIN],
        );
        console.log(`${risk}:`);

        // Each multiplier lands as often as its share of the wheel.
        for (const { multiplier, segments } of payTable(risk)) {
          const row = rows.find((r) => r.m === multiplier);
          expectRate(`  ${(multiplier / 100).toFixed(2)}x on ${segments}/30`, Number(row?.n ?? 0), ROUNDS, segments / 30);
        }

        // Paid back, against 99%. Every landing on one multiplier pays the
        // same, so its spread is known exactly from the table.
        const staked = ROUNDS * 100 * COIN;
        const paid = rows.reduce((s, r) => s + Number(r.paid), 0);
        const xs = WHEELS[risk].map((m) => m / 100);
        const mean = xs.reduce((s, x) => s + x, 0) / 30;
        const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / 30;
        expect(mean).toBeCloseTo(0.99, 10);
        report("  paid back", paid / staked, 0.99, Math.sqrt(variance / ROUNDS), 3);
      }
    },
    600_000,
  );
});

describe("wheel: 10,000 real auto bets through the ledger", () => {
  it(
    "lands at the predicted rate and every coin adds up",
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

      let state = startAuto(settings);
      let wins = 0;
      let staked = 0;
      let paid = 0;
      let stop = null;
      let lastBalance = WELCOME;
      while (!stop) {
        const round = await playWheel(db, player, state.amount, "medium", newKey());
        if (round.won) wins++;
        staked += state.amount;
        paid += round.payout;
        lastBalance = round.balance;
        ({ state, stop } = afterRound(settings, state, { amount: state.amount, payout: round.payout }, round.balance));
      }

      expect(stop).toBe("count");
      expect(state.betsPlaced).toBe(10_000);
      expectRate("auto, medium, anything paid", wins, 10_000, 15 / 30);

      // Every coin: the welcome grant, minus every bet, plus every payout.
      expect(state.net).toBe(paid - staked);
      expect(lastBalance).toBe(WELCOME - staked + paid);
      expect(await balance(db, player)).toBe(WELCOME - staked + paid);
      const lines = await ledgerRows(db, player);
      expect(lines.filter((l) => l.kind === "bet")).toHaveLength(10_000);
      expect(lines.filter((l) => l.kind === "payout")).toHaveLength(wins);
    },
    600_000,
  );
});
