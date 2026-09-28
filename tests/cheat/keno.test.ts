import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fairNumbers } from "../../src/lib/fairness";
import {
  PAYTABLE,
  countHits,
  kenoDraw,
  kenoMultiplier,
  payoutUnits,
  returnPercent,
  validPicks,
} from "../../src/lib/keno";
import {
  COIN,
  WELCOME,
  balance,
  connect,
  ledgerRows,
  newAccount,
  newKey,
  placeBet,
  playKeno,
  rotateSeed,
  seedStatus,
  settle,
  sleep,
  type KenoResult,
} from "../db/helpers";

// Keno, from ROADMAP session 07. 40 numbers, 10 drawn. The spin gives 10
// fair numbers; each picks from the numbers still left: position =
// floor(number x how many are left), counting from the lowest. A player
// picks 1 to 10 different numbers. Hits = picks that were drawn. A round
// pays bet x the table's multiplier for (picks, hits), rounded down to the
// hundredth of a coin.

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

async function kenoRounds(account: string) {
  const { rows } = await a.query(
    "select spin, picks, drawn, hits, payout::bigint as payout from public.keno_rounds where account_id = $1 order by id",
    [account],
  );
  return rows.map((r) => ({
    spin: Number(r.spin),
    picks: r.picks as number[],
    drawn: r.drawn as number[],
    hits: r.hits as number,
    payout: Number(r.payout),
  }));
}

describe("keno: the maths", () => {
  it("has the table Asher approved", () => {
    expect(PAYTABLE).toEqual({
      1: [0, 396],
      2: [0, 147, 735],
      3: [0, 0, 383, 3835],
      4: [0, 0, 178, 1192, 5963],
      5: [0, 0, 84, 505, 3370, 8426],
      6: [0, 0, 0, 278, 1854, 9274, 23187],
      7: [0, 0, 0, 168, 842, 4213, 16852, 42131],
      8: [0, 0, 0, 0, 498, 3118, 14966, 49888, 124720],
      9: [0, 0, 0, 0, 284, 1518, 7592, 28470, 75922, 189805],
      10: [0, 0, 0, 0, 166, 833, 4165, 16662, 55543, 138857, 277715],
    });
  });

  it("returns the percentages Asher was shown, all at or just under 99%", () => {
    const shown: Record<number, number> = {
      1: 99.0, 2: 98.9423, 3: 98.9119, 4: 98.783, 5: 98.8774,
      6: 98.9441, 7: 98.8773, 8: 98.9335, 9: 98.9103, 10: 98.8957,
    };
    for (let picks = 1; picks <= 10; picks++) {
      const r = returnPercent(picks);
      expect(r, `${picks} picks`).toBeLessThanOrEqual(99);
      expect(r, `${picks} picks`).toBeGreaterThan(98.7);
      expect(Math.floor(r * 10_000) / 10_000, `${picks} picks`).toBe(shown[picks]);
    }
  });

  it("draws 10 different numbers, each from what is left", () => {
    expect(kenoDraw(Array(10).fill(0))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(kenoDraw(Array(10).fill((N - 1) / N))).toEqual([40, 39, 38, 37, 36, 35, 34, 33, 32, 31]);
    expect(kenoDraw(Array(10).fill(0.5))).toEqual([21, 20, 22, 19, 23, 18, 24, 17, 25, 16]);
  });

  it("counts hits, whatever order the picks are in", () => {
    const drawn = [21, 20, 22, 19, 23, 18, 24, 17, 25, 16];
    expect(countHits([1], drawn)).toBe(0);
    expect(countHits([21], drawn)).toBe(1);
    expect(countHits([16, 40, 21, 1, 25], drawn)).toBe(3);
    expect(countHits(drawn, drawn)).toBe(10);
  });

  it("allows 1 to 10 different whole numbers from 1 to 40, and nothing else", () => {
    expect(validPicks([1])).toBe(true);
    expect(validPicks([40, 1, 20])).toBe(true);
    expect(validPicks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(true);
    for (const picks of [[], [0], [41], [-1], [1, 1], [1.5], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]) {
      expect(validPicks(picks), JSON.stringify(picks)).toBe(false);
    }
  });

  it("pays bet x multiplier, rounded down", () => {
    expect(kenoMultiplier(1, 1)).toBe(396);
    expect(kenoMultiplier(10, 10)).toBe(277715);
    expect(kenoMultiplier(11, 0)).toBeNull();
    expect(kenoMultiplier(3, 4)).toBeNull();
    expect(payoutUnits(100 * COIN, 1, 1)).toBe(396 * COIN);
    expect(payoutUnits(100 * COIN, 1, 0)).toBe(0);
    // 7 units x 0.84 = 5.88 rounds down to 5.
    expect(payoutUnits(7, 5, 2)).toBe(5);
  });

  it("draws the same numbers in the browser and the database", async () => {
    const samples = [
      Array(10).fill(0),
      Array(10).fill((N - 1) / N),
      Array(10).fill(0.5),
      [1234567, 3999999999, 7, 2 ** 31, 42, N - 1, 99, 123456789, 3e9, 1].map((k) => k / N),
    ];
    for (const numbers of samples) {
      const { rows } = await a.query("select public.keno_draw($1::double precision[]) as drawn", [numbers]);
      expect(rows[0].drawn).toEqual(kenoDraw(numbers));
    }
  });

  it("has the same table in the browser and the database, and agrees on every payout", async () => {
    for (let picks = 1; picks <= 10; picks++) {
      for (let hits = 0; hits <= picks; hits++) {
        const { rows } = await a.query(
          "select public.keno_multiplier($1, $2) as m, public.keno_payout($3, $1, $2)::bigint as p, public.keno_payout(7, $1, $2)::bigint as p7",
          [picks, hits, 123457],
        );
        expect(rows[0].m, `${picks}/${hits}`).toBe(kenoMultiplier(picks, hits));
        expect(Number(rows[0].p), `${picks}/${hits}`).toBe(payoutUnits(123457, picks, hits));
        expect(Number(rows[0].p7), `${picks}/${hits}`).toBe(payoutUnits(7, picks, hits));
      }
    }
  });
});

describe("keno: a round", () => {
  it("takes the bet, counts hits, and pays exactly what the table says", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    const picks = [3, 9, 14, 27, 40];
    const results: KenoResult[] = [];

    for (let i = 0; i < 40; i++) results.push(await playKeno(a, player, bet, picks, newKey()));

    for (const r of results) {
      expect(r.drawn).toHaveLength(10);
      expect(new Set(r.drawn).size).toBe(10);
      expect(r.hits).toBe(countHits(picks, r.drawn));
      expect(r.multiplier).toBe(kenoMultiplier(5, r.hits));
      expect(r.payout).toBe(payoutUnits(bet, 5, r.hits));
      expect(r.won).toBe(r.payout > 0);
    }
    // 5 picks pays on 2 or more hits: 36.7% a round, so both kinds are all but certain.
    expect(results.some((r) => r.won)).toBe(true);
    expect(results.some((r) => !r.won)).toBe(true);

    const paid = results.reduce((s, r) => s + r.payout, 0);
    const expected = WELCOME - 40 * bet + paid;
    expect(await balance(a, player)).toBe(expected);
    expect(results.at(-1)!.balance).toBe(expected);

    const lines = await ledgerRows(a, player);
    expect(lines.filter((l) => l.kind === "bet")).toHaveLength(40);
    expect(lines.filter((l) => l.kind === "payout")).toHaveLength(results.filter((r) => r.won).length);
  });

  it("uses one spin number per round, however many numbers it draws", async () => {
    const player = await newAccount(a);
    const before = (await seedStatus(a, player)).nextSpin;
    const spins: number[] = [];
    for (let i = 0; i < 5; i++) spins.push((await playKeno(a, player, COIN, [1, 2, 3], newKey())).spin);
    expect(spins).toEqual([before, before + 1, before + 2, before + 3, before + 4]);
    expect((await seedStatus(a, player)).nextSpin).toBe(before + 5);
  });

  it("gives a draw anyone can check with the revealed secret", async () => {
    const player = await newAccount(a);
    const rounds: KenoResult[] = [];
    for (let i = 0; i < 10; i++) rounds.push(await playKeno(a, player, COIN, [5, 10, 15, 20, 25, 30, 35], newKey()));

    const { revealed } = await rotateSeed(a, player, null);
    for (const round of rounds) {
      const numbers = await fairNumbers(revealed.serverSeed, revealed.clientWord, round.spin, 10);
      expect(round.drawn).toEqual(kenoDraw(numbers));
      expect(round.payout).toBe(payoutUnits(COIN, 7, countHits([5, 10, 15, 20, 25, 30, 35], round.drawn)));
    }
  });

  it("remembers the picks in order, whatever order they were sent in", async () => {
    const player = await newAccount(a);
    await playKeno(a, player, COIN, [30, 2, 17], newKey());
    expect((await kenoRounds(player))[0].picks).toEqual([2, 17, 30]);
  });
});

describe("cheat: the same keno bet sent twice", () => {
  it("returns the first result and changes nothing when repeated later", async () => {
    const player = await newAccount(a);
    const key = newKey();

    const first = await playKeno(a, player, 10 * COIN, [1, 2, 3, 4], key);
    const after = await balance(a, player);
    const spinAfter = (await seedStatus(a, player)).nextSpin;
    // Same picks in a different order is the same bet.
    const second = await playKeno(b, player, 10 * COIN, [4, 3, 2, 1], key);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.roundId).toBe(first.roundId);
    expect(second.drawn).toEqual(first.drawn);
    expect(second.payout).toBe(first.payout);
    expect(await balance(a, player)).toBe(after);
    expect((await seedStatus(a, player)).nextSpin).toBe(spinAfter);
    expect(await kenoRounds(player)).toHaveLength(1);
  });

  it("settles once when the repeat arrives mid-flight", async () => {
    const player = await newAccount(a);
    const key = newKey();

    await a.query("begin");
    let first: KenoResult;
    try {
      first = await playKeno(a, player, 10 * COIN, [7, 8], key);
    } catch (error) {
      await a.query("rollback");
      throw error;
    }
    const repeat = settle(playKeno(b, player, 10 * COIN, [7, 8], key));
    await sleep(300);
    await a.query("commit");

    const second = await repeat;
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.replayed).toBe(true);
      expect(second.value.drawn).toEqual(first.drawn);
    }
    expect(await kenoRounds(player)).toHaveLength(1);
    expect(await balance(a, player)).toBe(WELCOME - 10 * COIN + first.payout);
  });

  it("refuses a repeated key with different picks or amount", async () => {
    const player = await newAccount(a);
    const key = newKey();
    await playKeno(a, player, 10 * COIN, [1, 2, 3], key);
    const after = await balance(a, player);

    for (const [amount, picks] of [
      [10 * COIN, [1, 2, 4]],
      [10 * COIN, [1, 2]],
      [10 * COIN, [1, 2, 3, 4]],
      [20 * COIN, [1, 2, 3]],
    ] as const) {
      const result = await settle(playKeno(a, player, amount, [...picks], key));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/idempotency_key_reused/);
    }
    expect(await balance(a, player)).toBe(after);
    expect(await kenoRounds(player)).toHaveLength(1);
  });

  it("refuses a key already used by some other bet", async () => {
    const player = await newAccount(a);
    const key = newKey();
    await placeBet(a, player, 10 * COIN, key);

    const result = await settle(playKeno(a, player, 10 * COIN, [1], key));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/idempotency_key_reused/);
    expect(await kenoRounds(player)).toHaveLength(0);
  });
});

describe("cheat: bad keno bets", () => {
  const refusals: Array<[string, number, number[], RegExp]> = [
    ["more than the balance", WELCOME + 1, [1], /insufficient_balance/],
    ["zero coins", 0, [1], /invalid_amount/],
    ["negative coins", -10 * COIN, [1], /invalid_amount/],
    ["no picks", COIN, [], /invalid_picks/],
    ["eleven picks", COIN, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], /invalid_picks/],
    ["the same number twice", COIN, [5, 5], /invalid_picks/],
    ["a number below 1", COIN, [0, 1], /invalid_picks/],
    ["a number above 40", COIN, [40, 41], /invalid_picks/],
    ["a negative number", COIN, [-3], /invalid_picks/],
  ];

  for (const [what, amount, picks, error] of refusals) {
    it(`refuses ${what} and changes nothing, not even the spin number`, async () => {
      const player = await newAccount(a);
      const spin = (await seedStatus(a, player)).nextSpin;

      const result = await settle(playKeno(a, player, amount, picks, newKey()));

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(error);
      expect(await balance(a, player)).toBe(WELCOME);
      expect(await ledgerRows(a, player)).toHaveLength(1);
      expect((await seedStatus(a, player)).nextSpin).toBe(spin);
    });
  }

  it("refuses a missing list of picks", async () => {
    const player = await newAccount(a);
    const result = await settle(a.query("select * from public.play_keno($1, $2, null, $3)", [player, COIN, newKey()]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid_picks/);
    expect(await balance(a, player)).toBe(WELCOME);
  });

  it("refuses a pick with a null in it", async () => {
    const player = await newAccount(a);
    const result = await settle(
      a.query("select * from public.play_keno($1, $2, array[1, null]::int[], $3)", [player, COIN, newKey()]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid_picks/);
    expect(await balance(a, player)).toBe(WELCOME);
  });

  it("lets you bet your whole balance, then nothing more after a loss", async () => {
    const player = await newAccount(a);
    // 10 picks pays nothing on 3 hits or fewer: about 80% of rounds.
    const first = await playKeno(a, player, WELCOME, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], newKey());
    if (first.won) return; // The rest of this test doesn't apply.
    expect(first.balance).toBe(0);
    const next = await settle(playKeno(a, player, 1, [1], newKey()));
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error).toMatch(/insufficient_balance/);
  });
});

describe("cheat: keno bets fired at the same moment", () => {
  it("never overspends and never reuses a spin number", async () => {
    const player = await newAccount(a);
    const clients = await Promise.all(Array.from({ length: 20 }, connect));

    try {
      const results = await Promise.all(
        clients.map((c) => settle(playKeno(c, player, 1000 * COIN, [1, 2], newKey()))),
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
      expect(await kenoRounds(player)).toHaveLength(ok.length);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("cheat: keno rounds", () => {
  it("can't be edited or deleted", async () => {
    const player = await newAccount(a);
    await playKeno(a, player, COIN, [1, 2, 3], newKey());

    const edit = await settle(a.query("update public.keno_rounds set hits = 3 where account_id = $1", [player]));
    const remove = await settle(a.query("delete from public.keno_rounds where account_id = $1", [player]));
    for (const result of [edit, remove]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/keno_rounds_are_append_only/);
    }
  });
});

describe("cheat: the browser reaching keno directly", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read keno rounds`, async () => {
      const result = await as(role, "select * from public.keno_rounds");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });

    it(`${role} cannot call play_keno`, async () => {
      const player = await newAccount(a);
      const result = await as(role, "select * from public.play_keno($1, 100, array[1, 2]::int[], $2)", [
        player,
        newKey(),
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });
  }
});
