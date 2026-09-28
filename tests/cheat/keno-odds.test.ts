import { randomBytes } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { afterRound, startAuto, type AutoSettings } from "../../src/lib/auto-bet";
import { PAYTABLE, hitChance, returnPercent } from "../../src/lib/keno";
import { COIN, WELCOME, balance, connect, ledgerRows, newAccount, newKey, playKeno } from "../db/helpers";

// ROADMAP session 07: Keno gets the same million-round check as Dice.
//
// Part 1 makes one million draws with the database's own recipe and keno
// maths (fair_numbers with 10 numbers, keno_draw, keno_hits, keno_payout,
// exactly what play_keno uses), with a fresh random secret each run, and
// scores every draw for every pick count from 1 to 10. It skips only the
// ledger writes.
//
// Part 2 plays 10,000 real auto bets through play_keno and the ledger,
// driven by the same auto-bet rules the page uses, and checks every coin.
//
// Theoretical house edge: 100% - returnPercent(picks), from 1.00% (1 pick)
// to 1.22% (4 picks). Hit chances are the exact hypergeometric ones.
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

function expectRate(label: string, hits: number, rounds: number, p: number) {
  report(`${label} (${hits.toLocaleString("en-US")})`, hits / rounds, p, Math.sqrt((p * (1 - p)) / rounds));
}

describe("keno: one million draws", () => {
  it(
    "draws every number equally, hits as often as the maths says, and pays back what the table says",
    async () => {
      const secret = randomBytes(32).toString("hex");
      const word = `odds-${randomBytes(4).toString("hex")}`;
      console.log(`secret ${secret}, word ${word}`);

      // Every draw, once, into a temporary table.
      await db.query("drop table if exists pg_temp.million");
      const started = Date.now();
      await db.query(
        `create temporary table million as
         select s.spin, public.keno_draw(public.fair_numbers($1, $2, s.spin, 10)) as drawn
         from generate_series(0, $3 - 1) as s(spin)`,
        [secret, word, ROUNDS],
      );
      console.log(`drew ${ROUNDS.toLocaleString("en-US")} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

      // Ten different numbers from 1 to 40 in every draw.
      const { rows: bad } = await db.query(
        `select count(*)::int as n from million
         where cardinality(drawn) <> 10
            or (select count(distinct d) from unnest(drawn) d) <> 10
            or exists (select 1 from unnest(drawn) d where d < 1 or d > 40)`,
      );
      expect(bad[0].n).toBe(0);

      // Every number equally often: 40 buckets, 39 degrees of freedom. Each
      // is drawn in a quarter of rounds.
      const { rows: buckets } = await db.query(
        "select d, count(*)::int as n from million, unnest(drawn) d group by 1 order by 1",
      );
      expect(buckets.map((r) => r.d)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
      const expected = (ROUNDS * 10) / 40;
      const chiSquare = buckets.reduce((sum, r) => sum + (r.n - expected) ** 2 / expected, 0);
      console.log(`evenness (chi-square, 39 degrees of freedom): ${chiSquare.toFixed(1)} (expected about 39, fail above 85)`);
      expect(chiSquare).toBeLessThan(85);

      // The first number drawn, alone, is also even.
      const { rows: firsts } = await db.query("select drawn[1] as d, count(*)::int as n from million group by 1");
      const firstChi = firsts.reduce((sum, r) => sum + (r.n - ROUNDS / 40) ** 2 / (ROUNDS / 40), 0);
      console.log(`first number drawn, evenness: ${firstChi.toFixed(1)} (expected about 39, fail above 85)`);
      expect(firstChi).toBeLessThan(85);

      for (let picks = 1; picks <= 10; picks++) {
        // Pick 1, 2, ... up to `picks`. Every number is alike, so any picks would do.
        const chosen = Array.from({ length: picks }, (_, i) => i + 1);
        const { rows } = await db.query(
          `select hits, count(*)::bigint as n, sum(public.keno_payout($2, $3, hits))::bigint as paid
           from (select public.keno_hits($1, drawn) as hits from million) t
           group by hits order by hits`,
          [chosen, 100 * COIN, picks],
        );
        console.log(`${picks} picks:`);

        // Each hit count, as often as predicted. Lines expected fewer than
        // 10 times in a million are only counted into the return below.
        for (let hits = 0; hits <= picks; hits++) {
          const p = hitChance(picks, hits);
          const n = Number(rows.find((r) => r.hits === hits)?.n ?? 0);
          if (p * ROUNDS >= 10) expectRate(`  ${hits} hits`, n, ROUNDS, p);
          else console.log(`  ${hits} hits: ${n} (predicted ${(p * ROUNDS).toFixed(3)} in a million, too rare to test)`);
        }

        // Paid back, against the exact return. Its spread comes from the table.
        const staked = ROUNDS * 100 * COIN;
        const paid = rows.reduce((s, r) => s + Number(r.paid), 0);
        const mean = returnPercent(picks) / 100;
        let variance = 0;
        for (let hits = 0; hits <= picks; hits++) {
          variance += hitChance(picks, hits) * (PAYTABLE[picks][hits] / 100 - mean) ** 2;
        }
        report(`  paid back`, paid / staked, mean, Math.sqrt(variance / ROUNDS), 3);
      }
    },
    900_000,
  );
});

describe("keno: 10,000 real auto bets through the ledger", () => {
  it(
    "pays at the predicted rate and every coin adds up",
    async () => {
      const player = await newAccount(db);
      const picks = [4, 8, 15, 16, 23];
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
        const round = await playKeno(db, player, state.amount, picks, newKey());
        if (round.won) wins++;
        staked += state.amount;
        paid += round.payout;
        lastBalance = round.balance;
        ({ state, stop } = afterRound(settings, state, { amount: state.amount, payout: round.payout }, round.balance));
      }

      expect(stop).toBe("count");
      expect(state.betsPlaced).toBe(10_000);
      // 5 picks pays on 2 or more hits.
      const p = [2, 3, 4, 5].reduce((s, h) => s + hitChance(5, h), 0);
      expectRate("auto, 5 picks, anything paid", wins, 10_000, p);

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
