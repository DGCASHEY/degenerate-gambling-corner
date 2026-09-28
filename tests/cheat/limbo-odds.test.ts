import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { afterRound, startAuto, type AutoSettings } from "../../src/lib/auto-bet";
import { COIN, WELCOME, balance, connect, ledgerRows, newAccount, newKey, playLimbo } from "../db/helpers";

// ROADMAP session 07: Limbo gets the same million-round check as Dice.
//
// Part 1 draws one million results with the database's own recipe and limbo
// maths (fair_numbers, limbo_result, limbo_payout, exactly what play_limbo
// uses), with a fresh random secret each run. It skips only the ledger
// writes, which would take hours at this size.
//
// Part 2 plays 10,000 real auto bets through play_limbo and the ledger,
// driven by the same auto-bet rules the page uses, and checks every coin.
//
// Theoretical house edge: 1%. A target T (in hundredths) wins on
// floor(99 x 2^32 / T) of the 2^32 fair numbers, so the win chance is
// 0.99 / T (to within one part in four billion) and a win pays T.
//
// Pass mark: within 4.5 standard errors of the prediction, as for Dice.

const ROUNDS = 1_000_000;
const TOLERANCE = 4.5;
const N = 2 ** 32;

let db: pg.Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

// Within TOLERANCE standard errors of the predicted rate?
function expectRate(label: string, hits: number, rounds: number, p: number) {
  const observed = hits / rounds;
  const standardError = Math.sqrt((p * (1 - p)) / rounds);
  const z = (observed - p) / standardError;
  console.log(
    `${label}: ${hits.toLocaleString("en-US")} / ${rounds.toLocaleString("en-US")} = ${(observed * 100).toFixed(4)}%` +
      ` (predicted ${(p * 100).toFixed(4)}%, ${z >= 0 ? "+" : ""}${z.toFixed(2)} standard errors)`,
  );
  expect(Math.abs(z), label).toBeLessThan(TOLERANCE);
}

describe("limbo: one million rounds", () => {
  it(
    "wins as often as the maths says and pays back 99% at every target",
    async () => {
      const secret = randomBytes(32).toString("hex");
      const word = `odds-${randomBytes(4).toString("hex")}`;
      console.log(`secret ${secret}, word ${word}`);

      // Every result, once, into a temporary table.
      await db.query("drop table if exists pg_temp.million");
      const started = Date.now();
      await db.query(
        `create temporary table million as
         select s.spin, public.limbo_result((public.fair_numbers($1, $2, s.spin, 1))[1]) as result
         from generate_series(0, $3 - 1) as s(spin)`,
        [secret, word, ROUNDS],
      );
      console.log(`drew ${ROUNDS.toLocaleString("en-US")} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

      // Win rate and money paid back at a spread of targets, from 98% to 0.099%.
      for (const target of [101, 150, 200, 1_000, 10_000, 100_000]) {
        // Bet 100 coins each round. payout is 0 on a loss.
        const { rows } = await db.query(
          `select count(*) filter (where p > 0)::bigint as wins, sum(p)::bigint as paid
           from (select public.limbo_payout($1, $2, result) as p from million) t`,
          [100 * COIN, target],
        );
        const wins = Number(rows[0].wins);
        const p = Math.floor((99 * N) / target) / N;
        const label = `target ${(target / 100).toFixed(2)}x`;
        expectRate(label, wins, ROUNDS, p);

        // Every win pays the same, so paid back is wins x payout.
        const staked = ROUNDS * 100 * COIN;
        const paid = Number(rows[0].paid);
        const perWin = Math.floor((100 * COIN * target) / 100);
        expect(paid).toBe(wins * perWin);
        console.log(
          `  paid back ${((paid / staked) * 100).toFixed(3)}% (predicted ${((p * perWin * 100) / (100 * COIN)).toFixed(3)}%)`,
        );
      }

      // Results below 1.00x lose at every target: predicted 1 in 100.
      const { rows: under } = await db.query("select count(*)::bigint as n from million where result < 100");
      expectRate("results under 1.00x", Number(under[0].n), ROUNDS, 1 - Math.floor((99 * N) / 100) / N);

      // Nothing below 0.99x, ever.
      const { rows: range } = await db.query("select min(result)::bigint as lo from million");
      expect(Number(range[0].lo)).toBe(99);
    },
    600_000,
  );
});

describe("limbo: 10,000 real auto bets through the ledger", () => {
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

      let state = startAuto(settings);
      let wins = 0;
      let staked = 0;
      let paid = 0;
      let stop = null;
      let lastBalance = WELCOME;
      while (!stop) {
        const round = await playLimbo(db, player, state.amount, 200, newKey());
        if (round.won) wins++;
        staked += state.amount;
        paid += round.payout;
        lastBalance = round.balance;
        ({ state, stop } = afterRound(settings, state, { amount: state.amount, payout: round.payout }, round.balance));
      }

      expect(stop).toBe("count");
      expect(state.betsPlaced).toBe(10_000);
      expectRate("auto, target 2.00x", wins, 10_000, Math.floor((99 * N) / 200) / N);

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
