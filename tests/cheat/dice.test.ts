import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fairNumbers } from "../../src/lib/fairness";
import { diceRoll, payoutUnits, winningRolls } from "../../src/lib/dice";
import {
  COIN,
  WELCOME,
  balance,
  connect,
  ledgerRows,
  newAccount,
  newKey,
  placeBet,
  playDice,
  rotateSeed,
  seedStatus,
  settle,
  sleep,
  type DiceResult,
} from "../db/helpers";

// Dice, from ROADMAP session 06. Rolls are whole hundredths from 0 (0.00) to
// 9999 (99.99): 10,000 possible rolls. "under 5000" wins on 0-4999, "over
// 4999" wins on 5000-9999. A win pays bet x 99 / win chance, rounded down
// to the hundredth of a coin.

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

async function diceRounds(account: string) {
  const { rows } = await a.query(
    "select spin, roll, payout::bigint as payout from public.dice_rounds where account_id = $1 order by id",
    [account],
  );
  return rows.map((r) => ({ spin: Number(r.spin), roll: r.roll as number, payout: Number(r.payout) }));
}

describe("dice: the maths", () => {
  it("counts winning rolls exactly", () => {
    expect(winningRolls(5000, "under")).toBe(5000);
    expect(winningRolls(4999, "over")).toBe(5000);
    expect(winningRolls(1, "under")).toBe(1);
    expect(winningRolls(9998, "over")).toBe(1);
    expect(winningRolls(9800, "under")).toBe(9800);
    expect(winningRolls(199, "over")).toBe(9800);
  });

  it("refuses targets outside 0.01% to 98% win chance", () => {
    for (const [target, direction] of [
      [0, "under"],
      [9801, "under"],
      [198, "over"],
      [9999, "over"],
      [5000, "sideways"],
      [50.5, "under"],
    ] as const) {
      expect(winningRolls(target, direction as "under"), `${target} ${direction}`).toBeNull();
    }
  });

  it("pays bet x 9900 / winning rolls, rounded down, and nothing on a loss", () => {
    // 50% pays 1.98x.
    expect(payoutUnits(100 * COIN, 5000, "under", 4999)).toBe(198 * COIN);
    expect(payoutUnits(100 * COIN, 5000, "under", 5000)).toBe(0);
    // 49.5% pays exactly 2x.
    expect(payoutUnits(100 * COIN, 4950, "under", 0)).toBe(200 * COIN);
    // 3 winning rolls: 1 unit x 3300 = 3300 exactly.
    expect(payoutUnits(1, 3, "under", 2)).toBe(3300);
    // 9800 winning rolls: 1 unit x 1.0102... = 1 unit (rounded down).
    expect(payoutUnits(1, 9800, "under", 0)).toBe(1);
    // 7 winning rolls: 1 unit x 1414.2857 rounds down to 1414.
    expect(payoutUnits(1, 7, "under", 6)).toBe(1414);
  });

  it("turns a fair number into a roll the same way in the browser and the database", async () => {
    const samples = [0, 0.00005, 0.49995, 0.5, 0.99999999976716936, 4294967295 / 2 ** 32, 1234567 / 2 ** 32];
    for (const n of samples) {
      const { rows } = await a.query("select public.dice_roll($1::double precision) as roll", [n]);
      expect(rows[0].roll, String(n)).toBe(diceRoll(n));
    }
    expect(diceRoll(0)).toBe(0);
    expect(diceRoll(4294967295 / 2 ** 32)).toBe(9999);
  });

  it("agrees with the database on every payout", async () => {
    for (const [amount, target, direction, roll] of [
      [100 * COIN, 5000, "under", 4999],
      [100 * COIN, 5000, "under", 5000],
      [100 * COIN, 4999, "over", 5000],
      [100 * COIN, 4999, "over", 4999],
      [1, 7, "under", 6],
      [123457, 9800, "under", 9799],
      [999_999_999, 1, "under", 0],
    ] as const) {
      const { rows } = await a.query("select public.dice_payout($1, $2, $3, $4)::bigint as payout", [
        amount,
        target,
        direction,
        roll,
      ]);
      expect(Number(rows[0].payout)).toBe(payoutUnits(amount, target, direction, roll));
    }
  });
});

describe("dice: a round", () => {
  it("takes the bet, pays a win exactly, and pays nothing on a loss", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    const results: DiceResult[] = [];

    // 50% each: after 40 rounds, both a win and a loss are all but certain.
    for (let i = 0; i < 40; i++) results.push(await playDice(a, player, bet, 5000, "under", newKey()));

    const wins = results.filter((r) => r.won);
    const losses = results.filter((r) => !r.won);
    expect(wins.length).toBeGreaterThan(0);
    expect(losses.length).toBeGreaterThan(0);
    for (const r of wins) {
      expect(r.roll).toBeLessThan(5000);
      expect(r.payout).toBe(19.8 * COIN);
    }
    for (const r of losses) {
      expect(r.roll).toBeGreaterThanOrEqual(5000);
      expect(r.payout).toBe(0);
    }

    const expected = WELCOME - 40 * bet + wins.length * 19.8 * COIN;
    expect(await balance(a, player)).toBe(expected);
    expect(results.at(-1)!.balance).toBe(expected);

    // One bet line per round, one payout line per win, nothing else.
    const lines = await ledgerRows(a, player);
    expect(lines.filter((l) => l.kind === "bet")).toHaveLength(40);
    expect(lines.filter((l) => l.kind === "payout")).toHaveLength(wins.length);
    expect(lines.filter((l) => l.kind === "payout").every((l) => l.amount === 19.8 * COIN)).toBe(true);
  });

  it("uses a new spin number every round", async () => {
    const player = await newAccount(a);
    const before = (await seedStatus(a, player)).nextSpin;
    const spins: number[] = [];
    for (let i = 0; i < 5; i++) spins.push((await playDice(a, player, COIN, 5000, "under", newKey())).spin);
    expect(spins).toEqual([before, before + 1, before + 2, before + 3, before + 4]);
    expect((await seedStatus(a, player)).nextSpin).toBe(before + 5);
  });

  it("gives a roll anyone can check with the revealed secret", async () => {
    const player = await newAccount(a);
    const rounds: DiceResult[] = [];
    for (let i = 0; i < 10; i++) rounds.push(await playDice(a, player, COIN, 5000, "over", newKey()));

    const { revealed } = await rotateSeed(a, player, null);
    for (const round of rounds) {
      const [n] = await fairNumbers(revealed.serverSeed, revealed.clientWord, round.spin, 1);
      expect(round.roll).toBe(diceRoll(n));
      expect(round.payout).toBe(payoutUnits(COIN, 5000, "over", round.roll));
    }
  });
});

describe("cheat: the same dice bet sent twice", () => {
  it("returns the first result and changes nothing when repeated later", async () => {
    const player = await newAccount(a);
    const key = newKey();

    const first = await playDice(a, player, 10 * COIN, 5000, "under", key);
    const after = await balance(a, player);
    const spinAfter = (await seedStatus(a, player)).nextSpin;
    const second = await playDice(b, player, 10 * COIN, 5000, "under", key);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.roundId).toBe(first.roundId);
    expect(second.roll).toBe(first.roll);
    expect(second.payout).toBe(first.payout);
    expect(await balance(a, player)).toBe(after);
    expect((await seedStatus(a, player)).nextSpin).toBe(spinAfter);
    expect(await diceRounds(player)).toHaveLength(1);
  });

  it("settles once when the repeat arrives mid-flight", async () => {
    const player = await newAccount(a);
    const key = newKey();

    await a.query("begin");
    let first: DiceResult;
    try {
      first = await playDice(a, player, 10 * COIN, 5000, "under", key);
    } catch (error) {
      await a.query("rollback");
      throw error;
    }
    const repeat = settle(playDice(b, player, 10 * COIN, 5000, "under", key));
    await sleep(300);
    await a.query("commit");

    const second = await repeat;
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.replayed).toBe(true);
      expect(second.value.roll).toBe(first.roll);
    }
    expect(await diceRounds(player)).toHaveLength(1);
    expect(await balance(a, player)).toBe(WELCOME - 10 * COIN + first.payout);
  });

  it("refuses a repeated key with a different target, amount or direction", async () => {
    const player = await newAccount(a);
    const key = newKey();
    await playDice(a, player, 10 * COIN, 5000, "under", key);
    const after = await balance(a, player);

    for (const [amount, target, direction] of [
      [10 * COIN, 9000, "under"],
      [20 * COIN, 5000, "under"],
      [10 * COIN, 5000, "over"],
    ] as const) {
      const result = await settle(playDice(a, player, amount, target, direction, key));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/idempotency_key_reused/);
    }
    expect(await balance(a, player)).toBe(after);
    expect(await diceRounds(player)).toHaveLength(1);
  });

  it("refuses a key already used by some other bet", async () => {
    const player = await newAccount(a);
    const key = newKey();
    await placeBet(a, player, 10 * COIN, key);

    const result = await settle(playDice(a, player, 10 * COIN, 5000, "under", key));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/idempotency_key_reused/);
    expect(await diceRounds(player)).toHaveLength(0);
  });
});

describe("cheat: bad dice bets", () => {
  const refusals: Array<[string, number, number, string, RegExp]> = [
    ["more than the balance", WELCOME + 1, 5000, "under", /insufficient_balance/],
    ["zero coins", 0, 5000, "under", /invalid_amount/],
    ["negative coins", -10 * COIN, 5000, "under", /invalid_amount/],
    ["a certain win (under 99.99)", COIN, 9999, "under", /invalid_target/],
    ["over 98% (under 98.01)", COIN, 9801, "under", /invalid_target/],
    ["over 98% (over 1.98)", COIN, 198, "over", /invalid_target/],
    ["nothing can win (under 0.00)", COIN, 0, "under", /invalid_target/],
    ["nothing can win (over 99.99)", COIN, 9999, "over", /invalid_target/],
    ["a made-up direction", COIN, 5000, "sideways", /invalid_direction/],
  ];

  for (const [what, amount, target, direction, error] of refusals) {
    it(`refuses ${what} and changes nothing, not even the spin number`, async () => {
      const player = await newAccount(a);
      const spin = (await seedStatus(a, player)).nextSpin;

      const result = await settle(playDice(a, player, amount, target, direction, newKey()));

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
      a.query("select * from public.play_dice($1, $2, $3, $4, $5)", [player, COIN, 50.5, "under", newKey()]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid input syntax for type integer/);
    expect(await balance(a, player)).toBe(WELCOME);
  });

  it("lets you bet your whole balance, then nothing more after a loss", async () => {
    const player = await newAccount(a);
    // Over 99.98 wins only on 99.99: a 1 in 10,000 chance.
    const first = await playDice(a, player, WELCOME, 9998, "over", newKey());
    if (first.won) return; // 1 in 10,000: the rest of this test doesn't apply.
    expect(first.balance).toBe(0);
    const next = await settle(playDice(a, player, 1, 5000, "under", newKey()));
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error).toMatch(/insufficient_balance/);
  });
});

describe("cheat: dice bets fired at the same moment", () => {
  it("never overspends and never reuses a spin number", async () => {
    const player = await newAccount(a);
    const clients = await Promise.all(Array.from({ length: 20 }, connect));

    try {
      // 20 bets of 1,000 against 5,000. Wins pay back in, so how many get
      // through depends on the rolls. What can't change: the coins add up.
      const results = await Promise.all(
        clients.map((c) => settle(playDice(c, player, 1000 * COIN, 5000, "under", newKey()))),
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
      expect(await diceRounds(player)).toHaveLength(ok.length);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("cheat: the ledger's new payout line", () => {
  it("can never be negative, so it can't be used to take coins", async () => {
    const player = await newAccount(a);
    const result = await settle(
      a.query(
        "insert into public.ledger (account_id, amount, kind, idempotency_key) values ($1, -100, 'payout', $2)",
        [player, newKey()],
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ledger_amount_matches_kind/);
  });

  it("dice rounds can't be edited or deleted", async () => {
    const player = await newAccount(a);
    await playDice(a, player, COIN, 5000, "under", newKey());

    const edit = await settle(a.query("update public.dice_rounds set roll = 0 where account_id = $1", [player]));
    const remove = await settle(a.query("delete from public.dice_rounds where account_id = $1", [player]));
    for (const result of [edit, remove]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/dice_rounds_are_append_only/);
    }
  });
});

describe("cheat: the browser reaching dice directly", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot read dice rounds`, async () => {
      const result = await as(role, "select * from public.dice_rounds");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });

    it(`${role} cannot call play_dice`, async () => {
      const player = await newAccount(a);
      const result = await as(role, "select * from public.play_dice($1, 100, 5000, 'under', $2)", [
        player,
        newKey(),
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });
  }
});
