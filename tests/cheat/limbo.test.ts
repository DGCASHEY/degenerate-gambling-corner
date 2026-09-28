import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fairNumbers } from "../../src/lib/fairness";
import { limboResult, payoutUnits, winningNumbers } from "../../src/lib/limbo";
import {
  COIN,
  WELCOME,
  balance,
  connect,
  ledgerRows,
  newAccount,
  newKey,
  placeBet,
  playLimbo,
  rotateSeed,
  seedStatus,
  settle,
  sleep,
  type LimboResult,
} from "../db/helpers";

// Limbo, from ROADMAP session 07. Targets and results are whole hundredths
// of a multiplier: 200 means 2.00x. A fair number k / 2^32 gives the result
// 99 x 2^32 / (2^32 - k), rounded down. A result at or above the target wins
// and pays bet x target, rounded down to the hundredth of a coin. Targets
// run from 1.01x to 1,000,000.00x.

const N = 2 ** 32;

let a: pg.Client;
let b: pg.Client;

beforeAll(async () => {
  a = await connect();
  b = await connect();
});

afterAll(async () => {
  await a.end();
  await b.end();
});

// Runs one statement as someone other than the test's superuser, then undoes it.
async function as(role: "anon" | "authenticated", sql: string, params: unknown[] = []) {
  await a.query("begin");
  try {
    await a.query(`set local role ${role}`);
    return await settle(a.query(sql, params));
  } finally {
    await a.query("rollback");
  }
}

async function limboRounds(account: string) {
  const { rows } = await a.query(
    "select spin, result::bigint as result, payout::bigint as payout from public.limbo_rounds where account_id = $1 order by id",
    [account],
  );
  return rows.map((r) => ({ spin: Number(r.spin), result: Number(r.result), payout: Number(r.payout) }));
}

describe("limbo: the maths", () => {
  it("turns a fair number into a result exactly", () => {
    expect(limboResult(0)).toBe(99); // the lowest result: 0.99x
    expect(limboResult(0.5)).toBe(198);
    expect(limboResult(0.75)).toBe(396);
    // The edge of 1.00x: one number below it, the next one on it.
    expect(limboResult(42949672 / N)).toBe(99);
    expect(limboResult(42949673 / N)).toBe(100);
    // The highest possible result.
    expect(limboResult((N - 1) / N)).toBe(425201762304);
  });

  it("counts winning numbers exactly: 99 x 2^32 / target, rounded down", () => {
    expect(winningNumbers(101)).toBe(4209918438);
    expect(winningNumbers(200)).toBe(2126008811);
    expect(winningNumbers(1000)).toBe(425201762);
    expect(winningNumbers(100_000_000)).toBe(4252);
  });

  it("refuses targets outside 1.01x to 1,000,000.00x", () => {
    for (const target of [0, 99, 100, 100_000_001, -200, 150.5]) {
      expect(winningNumbers(target), String(target)).toBeNull();
    }
  });

  it("pays bet x target, rounded down, and nothing below the target", () => {
    expect(payoutUnits(100 * COIN, 200, 200)).toBe(200 * COIN);
    expect(payoutUnits(100 * COIN, 200, 199)).toBe(0);
    expect(payoutUnits(100 * COIN, 200, 425201762304)).toBe(200 * COIN);
    // 1 unit x 1.01 rounds down to 1 unit.
    expect(payoutUnits(1, 101, 101)).toBe(1);
    // 7 units x 3.33 = 23.31 rounds down to 23.
    expect(payoutUnits(7, 333, 400)).toBe(23);
    expect(payoutUnits(COIN, 100_000_000, 100_000_000)).toBe(1_000_000 * COIN);
  });

  it("turns a fair number into a result the same way in the browser and the database", async () => {
    const samples = [0, 0.5, 0.75, 42949672 / N, 42949673 / N, (N - 1) / N, 1234567 / N, 3999999999 / N];
    for (const n of samples) {
      const { rows } = await a.query("select public.limbo_result($1::double precision)::bigint as result", [n]);
      expect(Number(rows[0].result), String(n)).toBe(limboResult(n));
    }
  });

  it("agrees with the database on every payout", async () => {
    for (const [amount, target, result] of [
      [100 * COIN, 200, 200],
      [100 * COIN, 200, 199],
      [1, 101, 101],
      [7, 333, 400],
      [123457, 100_000_000, 425201762304],
      [999_999_999, 101, 99],
    ] as const) {
      const { rows } = await a.query("select public.limbo_payout($1, $2, $3)::bigint as payout", [
        amount,
        target,
        result,
      ]);
      expect(Number(rows[0].payout)).toBe(payoutUnits(amount, target, result));
    }
  });
});

describe("limbo: a round", () => {
  it("takes the bet, pays a win exactly, and pays nothing on a loss", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    const results: LimboResult[] = [];

    // 49.5% each at 2x: after 40 rounds, both a win and a loss are all but certain.
    for (let i = 0; i < 40; i++) results.push(await playLimbo(a, player, bet, 200, newKey()));

    const wins = results.filter((r) => r.won);
    const losses = results.filter((r) => !r.won);
    expect(wins.length).toBeGreaterThan(0);
    expect(losses.length).toBeGreaterThan(0);
    for (const r of wins) {
      expect(r.result).toBeGreaterThanOrEqual(200);
      expect(r.payout).toBe(20 * COIN);
    }
    for (const r of losses) {
      expect(r.result).toBeLessThan(200);
      expect(r.result).toBeGreaterThanOrEqual(99);
      expect(r.payout).toBe(0);
    }

    const expected = WELCOME - 40 * bet + wins.length * 20 * COIN;
    expect(await balance(a, player)).toBe(expected);
    expect(results.at(-1)!.balance).toBe(expected);

    // One bet line per round, one payout line per win, nothing else.
    const lines = await ledgerRows(a, player);
    expect(lines.filter((l) => l.kind === "bet")).toHaveLength(40);
    expect(lines.filter((l) => l.kind === "payout")).toHaveLength(wins.length);
    expect(lines.filter((l) => l.kind === "payout").every((l) => l.amount === 20 * COIN)).toBe(true);
  });

  it("uses a new spin number every round, shared with the other games", async () => {
    const player = await newAccount(a);
    const before = (await seedStatus(a, player)).nextSpin;
    const spins: number[] = [];
    for (let i = 0; i < 5; i++) spins.push((await playLimbo(a, player, COIN, 200, newKey())).spin);
    expect(spins).toEqual([before, before + 1, before + 2, before + 3, before + 4]);
    expect((await seedStatus(a, player)).nextSpin).toBe(before + 5);
  });

  it("gives a result anyone can check with the revealed secret", async () => {
    const player = await newAccount(a);
    const rounds: LimboResult[] = [];
    for (let i = 0; i < 10; i++) rounds.push(await playLimbo(a, player, COIN, 150, newKey()));

    const { revealed } = await rotateSeed(a, player, null);
    for (const round of rounds) {
      const [n] = await fairNumbers(revealed.serverSeed, revealed.clientWord, round.spin, 1);
      expect(round.result).toBe(limboResult(n));
      expect(round.payout).toBe(payoutUnits(COIN, 150, round.result));
    }
  });
});

describe("cheat: the same limbo bet sent twice", () => {
  it("returns the first result and changes nothing when repeated later", async () => {
    const player = await newAccount(a);
    const key = newKey();

    const first = await playLimbo(a, player, 10 * COIN, 200, key);
    const after = await balance(a, player);
    const spinAfter = (await seedStatus(a, player)).nextSpin;
    const second = await playLimbo(b, player, 10 * COIN, 200, key);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.roundId).toBe(first.roundId);
    expect(second.result).toBe(first.result);
    expect(second.payout).toBe(first.payout);
    expect(await balance(a, player)).toBe(after);
    expect((await seedStatus(a, player)).nextSpin).toBe(spinAfter);
    expect(await limboRounds(player)).toHaveLength(1);
  });

  it("settles once when the repeat arrives mid-flight", async () => {
    const player = await newAccount(a);
    const key = newKey();

    await a.query("begin");
    let first: LimboResult;
    try {
      first = await playLimbo(a, player, 10 * COIN, 200, key);
    } catch (error) {
      await a.query("rollback");
      throw error;
    }
    const repeat = settle(playLimbo(b, player, 10 * COIN, 200, key));
    await sleep(300);
    await a.query("commit");

    const second = await repeat;
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.replayed).toBe(true);
      expect(second.value.result).toBe(first.result);
    }
    expect(await limboRounds(player)).toHaveLength(1);
    expect(await balance(a, player)).toBe(WELCOME - 10 * COIN + first.payout);
  });

  it("refuses a repeated key with a different target or amount", async () => {
    const player = await newAccount(a);
    const key = newKey();
    await playLimbo(a, player, 10 * COIN, 200, key);
    const after = await balance(a, player);

    for (const [amount, target] of [
      [10 * COIN, 300],
      [20 * COIN, 200],
    ] as const) {
      const result = await settle(playLimbo(a, player, amount, target, key));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/idempotency_key_reused/);
    }
    expect(await balance(a, player)).toBe(after);
    expect(await limboRounds(player)).toHaveLength(1);
  });

  it("refuses a key already used by some other bet", async () => {
    const player = await newAccount(a);
    const key = newKey();
    await placeBet(a, player, 10 * COIN, key);

    const result = await settle(playLimbo(a, player, 10 * COIN, 200, key));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/idempotency_key_reused/);
    expect(await limboRounds(player)).toHaveLength(0);
  });
});

describe("cheat: bad limbo bets", () => {
  const refusals: Array<[string, number, number, RegExp]> = [
    ["more than the balance", WELCOME + 1, 200, /insufficient_balance/],
    ["zero coins", 0, 200, /invalid_amount/],
    ["negative coins", -10 * COIN, 200, /invalid_amount/],
    ["a target of 1.00x (can't lose money)", COIN, 100, /invalid_target/],
    ["a target below 1.00x", COIN, 99, /invalid_target/],
    ["a target of zero", COIN, 0, /invalid_target/],
    ["a negative target", COIN, -200, /invalid_target/],
    ["a target above 1,000,000x", COIN, 100_000_001, /invalid_target/],
  ];

  for (const [what, amount, target, error] of refusals) {
    it(`refuses ${what} and changes nothing, not even the spin number`, async () => {
      const player = await newAccount(a);
      const spin = (await seedStatus(a, player)).nextSpin;

      const result = await settle(playLimbo(a, player, amount, target, newKey()));

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(error);
      expect(await balance(a, player)).toBe(WELCOME);
      expect(await ledgerRows(a, player)).toHaveLength(1);
      expect((await seedStatus(a, player)).nextSpin).toBe(spin);
    });
  }

  it("refuses a target that isn't a whole hundredth", async () => {
    const player = await newAccount(a);
    const result = await settle(
      a.query("select * from public.play_limbo($1, $2, $3, $4)", [player, COIN, 150.5, newKey()]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid input syntax for type integer/);
    expect(await balance(a, player)).toBe(WELCOME);
  });

  it("lets you bet your whole balance, then nothing more after a loss", async () => {
    const player = await newAccount(a);
    // 1,000,000x: about a 1 in a million chance.
    const first = await playLimbo(a, player, WELCOME, 100_000_000, newKey());
    if (first.won) return; // 1 in a million: the rest of this test doesn't apply.
    expect(first.balance).toBe(0);
    const next = await settle(playLimbo(a, player, 1, 200, newKey()));
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error).toMatch(/insufficient_balance/);
  });
});

describe("cheat: limbo bets fired at the same moment", () => {
  it("never overspends and never reuses a spin number", async () => {
    const player = await newAccount(a);
    const clients = await Promise.all(Array.from({ length: 20 }, connect));

    try {
      // 20 bets of 1,000 against 5,000. Wins pay back in, so how many get
      // through depends on the results. What can't change: the coins add up.
      const results = await Promise.all(
        clients.map((c) => settle(playLimbo(c, player, 1000 * COIN, 200, newKey()))),
      );
      const ok = results.flatMap((r) => (r.ok ? [r.value] : []));
      const refused = results.flatMap((r) => (r.ok ? [] : [r.error]));

      expect(ok.length).toBeGreaterThanOrEqual(5);
      for (const error of refused) expect(error).toMatch(/insufficient_balance/);

      const paid = ok.reduce((sum, r) => sum + r.payout, 0);
      expect(await balance(a, player)).toBe(WELCOME - ok.length * 1000 * COIN + paid);
      expect(await balance(a, player)).toBeGreaterThanOrEqual(0);

      const spins = ok.map((r) => r.spin).sort((x, y) => x - y);
      expect(new Set(spins).size).toBe(spins.length);
      expect(await limboRounds(player)).toHaveLength(ok.length);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("cheat: limbo rounds", () => {
  it("can't be edited or deleted", async () => {
    const player = await newAccount(a);
    await playLimbo(a, player, COIN, 200, newKey());

    const edit = await settle(a.query("update public.limbo_rounds set result = 425201762304 where account_id = $1", [player]));
    const remove = await settle(a.query("delete from public.limbo_rounds where account_id = $1", [player]));
    for (const result of [edit, remove]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/limbo_rounds_are_append_only/);
    }
  });

  it("can't share a spin with a dice round", async () => {
    // Each game has its own rounds table, but take_spin hands out each spin
    // number once per secret, so the same numbers never settle two bets.
    const player = await newAccount(a);
    const { rows } = await a.query("select * from public.play_dice($1, $2, 5000, 'under', $3)", [player, COIN, newKey()]);
    const limbo = await playLimbo(a, player, COIN, 200, newKey());
    expect(limbo.spin).toBe(Number(rows[0].spin) + 1);
  });
});

describe("cheat: the browser reaching limbo directly", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read limbo rounds`, async () => {
      const result = await as(role, "select * from public.limbo_rounds");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });

    it(`${role} cannot call play_limbo`, async () => {
      const player = await newAccount(a);
      const result = await as(role, "select * from public.play_limbo($1, 100, 200, $2)", [player, newKey()]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });
  }
});
