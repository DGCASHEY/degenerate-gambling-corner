import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fairNumbers } from "../../src/lib/fairness";
import { SEGMENTS, WHEELS, payoutUnits, wheelMultiplier, wheelSegment, type WheelRisk } from "../../src/lib/wheel";
import {
  COIN,
  WELCOME,
  balance,
  connect,
  ledgerRows,
  newAccount,
  newKey,
  placeBet,
  playWheel,
  rotateSeed,
  seedStatus,
  settle,
  sleep,
  type WheelResult,
} from "../db/helpers";

// Wheel, from ROADMAP session 07. 30 segments; the spin's first fair number
// x 30, rounded down, is where it lands (0 to 29). Each risk level has a
// fixed list of 30 multipliers, in whole hundredths, adding up to 99 x 30:
// a 1% house edge. A landing pays bet x multiplier, rounded down to the
// hundredth of a coin.

const N = 2 ** 32;
const RISKS: WheelRisk[] = ["low", "medium", "high"];

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

async function wheelRounds(account: string) {
  const { rows } = await a.query(
    "select spin, segment, payout::bigint as payout from public.wheel_rounds where account_id = $1 order by id",
    [account],
  );
  return rows.map((r) => ({ spin: Number(r.spin), segment: r.segment as number, payout: Number(r.payout) }));
}

// How many segments carry each multiplier.
function counts(risk: WheelRisk): Record<number, number> {
  const out: Record<number, number> = {};
  for (const m of WHEELS[risk]) out[m] = (out[m] ?? 0) + 1;
  return out;
}

describe("wheel: the maths", () => {
  it("has the three tables Asher approved, each paying back exactly 99%", () => {
    expect(SEGMENTS).toBe(30);
    expect(counts("low")).toEqual({ 0: 8, 120: 15, 150: 6, 270: 1 });
    expect(counts("medium")).toEqual({ 0: 15, 150: 6, 200: 6, 300: 2, 270: 1 });
    expect(counts("high")).toEqual({ 0: 29, 2970: 1 });
    for (const risk of RISKS) {
      expect(WHEELS[risk]).toHaveLength(30);
      expect(WHEELS[risk].reduce((s, m) => s + m, 0), risk).toBe(99 * 30);
    }
  });

  it("turns a fair number into a segment exactly", () => {
    expect(wheelSegment(0)).toBe(0);
    expect(wheelSegment(0.5)).toBe(15);
    expect(wheelSegment((N - 1) / N)).toBe(29);
    // The edge between segments 0 and 1 is at 2^32 / 30 = 143,165,576.53...
    expect(wheelSegment(143165576 / N)).toBe(0);
    expect(wheelSegment(143165577 / N)).toBe(1);
  });

  it("refuses a made-up risk level", () => {
    expect(wheelMultiplier("extreme" as WheelRisk, 0)).toBeNull();
    expect(wheelMultiplier("low", 30)).toBeNull();
    expect(wheelMultiplier("low", -1)).toBeNull();
  });

  it("pays bet x multiplier, rounded down, and nothing on a 0x segment", () => {
    const zero = WHEELS.medium.indexOf(0);
    const x150 = WHEELS.medium.indexOf(150);
    const top = WHEELS.high.indexOf(2970);
    expect(payoutUnits(100 * COIN, "medium", zero)).toBe(0);
    expect(payoutUnits(100 * COIN, "medium", x150)).toBe(150 * COIN);
    expect(payoutUnits(100 * COIN, "high", top)).toBe(2970 * COIN);
    // 7 units x 1.50 = 10.5 rounds down to 10.
    expect(payoutUnits(7, "medium", x150)).toBe(10);
    // 1 unit x 1.20 rounds down to 1.
    expect(payoutUnits(1, "low", WHEELS.low.indexOf(120))).toBe(1);
  });

  it("has the same tables in the browser and the database, segment by segment", async () => {
    for (const risk of RISKS) {
      for (let segment = 0; segment < 30; segment++) {
        const { rows } = await a.query("select public.wheel_multiplier($1, $2) as m", [risk, segment]);
        expect(rows[0].m, `${risk} ${segment}`).toBe(wheelMultiplier(risk, segment));
      }
    }
  });

  it("turns a fair number into a segment the same way in the browser and the database", async () => {
    const samples = [0, 0.5, 143165576 / N, 143165577 / N, (N - 1) / N, 1234567 / N, 3999999999 / N];
    for (const n of samples) {
      const { rows } = await a.query("select public.wheel_segment($1::double precision) as segment", [n]);
      expect(rows[0].segment, String(n)).toBe(wheelSegment(n));
    }
  });

  it("agrees with the database on every payout", async () => {
    for (const risk of RISKS) {
      for (const amount of [1, 7, 100 * COIN, 123457]) {
        for (let segment = 0; segment < 30; segment++) {
          const { rows } = await a.query("select public.wheel_payout($1, $2, $3)::bigint as payout", [
            amount,
            risk,
            segment,
          ]);
          expect(Number(rows[0].payout), `${risk} ${amount} ${segment}`).toBe(payoutUnits(amount, risk, segment));
        }
      }
    }
  });
});

describe("wheel: a round", () => {
  it("takes the bet, pays each landing exactly, and pays nothing on 0x", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    const results: WheelResult[] = [];

    // Medium is half 0x: after 40 rounds, both kinds are all but certain.
    for (let i = 0; i < 40; i++) results.push(await playWheel(a, player, bet, "medium", newKey()));

    const wins = results.filter((r) => r.won);
    expect(wins.length).toBeGreaterThan(0);
    expect(results.filter((r) => !r.won).length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.multiplier).toBe(WHEELS.medium[r.segment]);
      expect(r.payout).toBe(payoutUnits(bet, "medium", r.segment));
      expect(r.won).toBe(r.payout > 0);
    }

    const paid = results.reduce((s, r) => s + r.payout, 0);
    const expected = WELCOME - 40 * bet + paid;
    expect(await balance(a, player)).toBe(expected);
    expect(results.at(-1)!.balance).toBe(expected);

    // One bet line per round, one payout line per paying landing, nothing else.
    const lines = await ledgerRows(a, player);
    expect(lines.filter((l) => l.kind === "bet")).toHaveLength(40);
    expect(lines.filter((l) => l.kind === "payout")).toHaveLength(wins.length);
  });

  it("uses a new spin number every round", async () => {
    const player = await newAccount(a);
    const before = (await seedStatus(a, player)).nextSpin;
    const spins: number[] = [];
    for (let i = 0; i < 5; i++) spins.push((await playWheel(a, player, COIN, "low", newKey())).spin);
    expect(spins).toEqual([before, before + 1, before + 2, before + 3, before + 4]);
    expect((await seedStatus(a, player)).nextSpin).toBe(before + 5);
  });

  it("gives a landing anyone can check with the revealed secret", async () => {
    const player = await newAccount(a);
    const rounds: WheelResult[] = [];
    for (let i = 0; i < 10; i++) rounds.push(await playWheel(a, player, COIN, "high", newKey()));

    const { revealed } = await rotateSeed(a, player, null);
    for (const round of rounds) {
      const [n] = await fairNumbers(revealed.serverSeed, revealed.clientWord, round.spin, 1);
      expect(round.segment).toBe(wheelSegment(n));
      expect(round.payout).toBe(payoutUnits(COIN, "high", round.segment));
    }
  });
});

describe("cheat: the same wheel bet sent twice", () => {
  it("returns the first result and changes nothing when repeated later", async () => {
    const player = await newAccount(a);
    const key = newKey();

    const first = await playWheel(a, player, 10 * COIN, "medium", key);
    const after = await balance(a, player);
    const spinAfter = (await seedStatus(a, player)).nextSpin;
    const second = await playWheel(b, player, 10 * COIN, "medium", key);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.roundId).toBe(first.roundId);
    expect(second.segment).toBe(first.segment);
    expect(second.multiplier).toBe(first.multiplier);
    expect(second.payout).toBe(first.payout);
    expect(await balance(a, player)).toBe(after);
    expect((await seedStatus(a, player)).nextSpin).toBe(spinAfter);
    expect(await wheelRounds(player)).toHaveLength(1);
  });

  it("settles once when the repeat arrives mid-flight", async () => {
    const player = await newAccount(a);
    const key = newKey();

    await a.query("begin");
    let first: WheelResult;
    try {
      first = await playWheel(a, player, 10 * COIN, "medium", key);
    } catch (error) {
      await a.query("rollback");
      throw error;
    }
    const repeat = settle(playWheel(b, player, 10 * COIN, "medium", key));
    await sleep(300);
    await a.query("commit");

    const second = await repeat;
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.replayed).toBe(true);
      expect(second.value.segment).toBe(first.segment);
    }
    expect(await wheelRounds(player)).toHaveLength(1);
    expect(await balance(a, player)).toBe(WELCOME - 10 * COIN + first.payout);
  });

  it("refuses a repeated key with a different risk or amount", async () => {
    const player = await newAccount(a);
    const key = newKey();
    await playWheel(a, player, 10 * COIN, "medium", key);
    const after = await balance(a, player);

    for (const [amount, risk] of [
      [10 * COIN, "high"],
      [20 * COIN, "medium"],
    ] as const) {
      const result = await settle(playWheel(a, player, amount, risk, key));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/idempotency_key_reused/);
    }
    expect(await balance(a, player)).toBe(after);
    expect(await wheelRounds(player)).toHaveLength(1);
  });

  it("refuses a key already used by some other bet", async () => {
    const player = await newAccount(a);
    const key = newKey();
    await placeBet(a, player, 10 * COIN, key);

    const result = await settle(playWheel(a, player, 10 * COIN, "low", key));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/idempotency_key_reused/);
    expect(await wheelRounds(player)).toHaveLength(0);
  });
});

describe("cheat: bad wheel bets", () => {
  const refusals: Array<[string, number, string, RegExp]> = [
    ["more than the balance", WELCOME + 1, "low", /insufficient_balance/],
    ["zero coins", 0, "low", /invalid_amount/],
    ["negative coins", -10 * COIN, "low", /invalid_amount/],
    ["a made-up risk level", COIN, "extreme", /invalid_risk/],
    ["an empty risk level", COIN, "", /invalid_risk/],
    ["a risk level in capitals", COIN, "HIGH", /invalid_risk/],
  ];

  for (const [what, amount, risk, error] of refusals) {
    it(`refuses ${what} and changes nothing, not even the spin number`, async () => {
      const player = await newAccount(a);
      const spin = (await seedStatus(a, player)).nextSpin;

      const result = await settle(playWheel(a, player, amount, risk, newKey()));

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(error);
      expect(await balance(a, player)).toBe(WELCOME);
      expect(await ledgerRows(a, player)).toHaveLength(1);
      expect((await seedStatus(a, player)).nextSpin).toBe(spin);
    });
  }

  it("lets you bet your whole balance, then nothing more after a loss", async () => {
    const player = await newAccount(a);
    // High risk: 29 of 30 segments pay nothing.
    const first = await playWheel(a, player, WELCOME, "high", newKey());
    if (first.won) return; // 1 in 30: the rest of this test doesn't apply.
    expect(first.balance).toBe(0);
    const next = await settle(playWheel(a, player, 1, "low", newKey()));
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error).toMatch(/insufficient_balance/);
  });
});

describe("cheat: wheel bets fired at the same moment", () => {
  it("never overspends and never reuses a spin number", async () => {
    const player = await newAccount(a);
    const clients = await Promise.all(Array.from({ length: 20 }, connect));

    try {
      // 20 bets of 1,000 against 5,000. Wins pay back in, so how many get
      // through depends on the landings. What can't change: the coins add up.
      const results = await Promise.all(
        clients.map((c) => settle(playWheel(c, player, 1000 * COIN, "medium", newKey()))),
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
      expect(await wheelRounds(player)).toHaveLength(ok.length);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("cheat: wheel rounds", () => {
  it("can't be edited or deleted", async () => {
    const player = await newAccount(a);
    await playWheel(a, player, COIN, "high", newKey());

    const edit = await settle(a.query("update public.wheel_rounds set segment = 0 where account_id = $1", [player]));
    const remove = await settle(a.query("delete from public.wheel_rounds where account_id = $1", [player]));
    for (const result of [edit, remove]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/wheel_rounds_are_append_only/);
    }
  });
});

describe("cheat: the browser reaching wheel directly", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read wheel rounds`, async () => {
      const result = await as(role, "select * from public.wheel_rounds");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });

    it(`${role} cannot call play_wheel`, async () => {
      const player = await newAccount(a);
      const result = await as(role, "select * from public.play_wheel($1, 100, 'high', $2)", [player, newKey()]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });
  }
});
