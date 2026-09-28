import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { afterRound, startAuto, type AutoSettings } from "../../src/lib/auto-bet";
import { COIN, WELCOME, balance, connect, ledgerRows, newAccount, newKey, playDice } from "../db/helpers";

// ROADMAP session 06: "one million simulated rounds match the predicted
// win rate".
//
// Part 1 rolls one million times with the database's own recipe and dice
// maths (fair_numbers, dice_roll, dice_payout, exactly what play_dice uses),
// with a fresh random secret each run. It skips only the ledger writes,
// which would take hours at this size.
//
// Part 2 plays 10,000 real auto bets through play_dice and the ledger,
// driven by the same auto-bet rules the page uses, and checks every coin.
//
// Pass mark: within 4.5 standard errors of the prediction. A fair game
// misses that about once in 150,000 runs. A game that is off by even 0.3
// percentage points misses it every time.

const ROUNDS = 1_000_000;
const TOLERANCE = 4.5;

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

describe("dice: one million rounds", () => {
  it(
    "wins as often as the maths says, pays back 99%, and every roll is equally likely",
    async () => {
      const secret = randomBytes(32).toString("hex");
      const word = `odds-${randomBytes(4).toString("hex")}`;
      console.log(`secret ${secret}, word ${word}`);

      // Every roll, once, into a temporary table.
      await db.query("drop table if exists pg_temp.million");
      const started = Date.now();
      await db.query(
        `create temporary table million as
         select s.spin, public.dice_roll((public.fair_numbers($1, $2, s.spin, 1))[1]) as roll
         from generate_series(0, $3 - 1) as s(spin)`,
        [secret, word, ROUNDS],
      );
      console.log(`rolled ${ROUNDS.toLocaleString("en-US")} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

      // Win rate at a spread of targets, from near-certain to 1 in 10,000.
      const bets: Array<[number, "under" | "over"]> = [
        [9800, "under"], // 98%
        [5000, "under"], // 50%
        [4950, "under"], // 49.5%, pays 2x
        [5049, "over"], // 49.5%, the other side
        [1000, "under"], // 10%
        [9899, "over"], // 1%
        [9998, "over"], // 0.01%, pays 9,900x
      ];
      for (const [target, direction] of bets) {
        // Bet 100 coins each round. payout is 0 on a loss.
        const { rows } = await db.query(
          `select count(*) filter (where p > 0)::bigint as wins, sum(p)::bigint as paid,
                  public.dice_winning_rolls($1, $2) as winning
           from (select public.dice_payout($3, $1, $2, roll) as p from million) t`,
          [target, direction, 100 * COIN],
        );
        const wins = Number(rows[0].wins);
        const winning = Number(rows[0].winning);
        const p = winning / 10_000;
        const label = `${direction} ${(target / 100).toFixed(2)}`;
        expectRate(label, wins, ROUNDS, p);

        // Paid back: every win pays the same, so this is wins x payout.
        // Predicted: 99% of everything bet, less rounding down.
        const staked = ROUNDS * 100 * COIN;
        const paid = Number(rows[0].paid);
        const perWin = Math.floor((100 * COIN * 9900) / winning);
        expect(paid).toBe(wins * perWin);
        console.log(
          `  paid back ${((paid / staked) * 100).toFixed(3)}% (predicted ${((p * perWin * 100) / (100 * COIN)).toFixed(3)}%)`,
        );
      }

      // Every roll value, 0.00 to 99.99, in 100 buckets of 100 rolls each.
      const { rows: buckets } = await db.query(
        "select roll / 100 as bucket, count(*)::int as n from million group by 1 order by 1",
      );
      expect(buckets).toHaveLength(100);
      const expected = ROUNDS / 100;
      const chiSquare = buckets.reduce((sum, r) => sum + (r.n - expected) ** 2 / expected, 0);
      console.log(`evenness (chi-square, 99 degrees of freedom): ${chiSquare.toFixed(1)} (expected about 99, fail above 160)`);
      expect(chiSquare).toBeLessThan(160);

      const { rows: range } = await db.query("select min(roll) as lo, max(roll) as hi from million");
      expect(range[0]).toEqual({ lo: 0, hi: 9999 });
    },
    600_000,
  );
});

describe("dice: 10,000 real auto bets through the ledger", () => {
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
        const round = await playDice(db, player, state.amount, 4950, "under", newKey());
        if (round.won) wins++;
        staked += state.amount;
        paid += round.payout;
        lastBalance = round.balance;
        ({ state, stop } = afterRound(settings, state, { amount: state.amount, payout: round.payout }, round.balance));
      }

      expect(stop).toBe("count");
      expect(state.betsPlaced).toBe(10_000);
      expectRate("auto, under 49.50", wins, 10_000, 0.495);

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
