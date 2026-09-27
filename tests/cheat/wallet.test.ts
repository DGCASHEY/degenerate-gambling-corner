import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COIN,
  WELCOME,
  balance,
  connect,
  ledgerRows,
  newAccount,
  newKey,
  placeBet,
  settle,
  sleep,
} from "../db/helpers";

// The four cheating tests from ROADMAP session 04. Each one attacks the
// wallet the way a real cheater would, and checks no coins appear or vanish.

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

describe("cheat: the same bet sent twice at the same instant", () => {
  it("takes the coins once when the repeat arrives mid-flight", async () => {
    const player = await newAccount(a);
    const key = newKey();

    // Request one is inside its transaction and has not finished yet...
    await a.query("begin");
    await placeBet(a, player, 1000 * COIN, key);
    // ...when the identical request lands on another connection.
    const repeat = settle(placeBet(b, player, 1000 * COIN, key));
    await sleep(300);
    await a.query("commit");

    const second = await repeat;
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.replayed).toBe(true);
    expect(await balance(a, player)).toBe(WELCOME - 1000 * COIN);
    expect((await ledgerRows(a, player)).filter((r) => r.kind === "bet")).toHaveLength(1);
  });

  it("ignores a repeat that arrives after the first one finished", async () => {
    const player = await newAccount(a);
    const key = newKey();

    const first = await placeBet(a, player, 50 * COIN, key);
    const second = await placeBet(b, player, 50 * COIN, key);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.ledgerId).toBe(first.ledgerId);
    expect(await balance(a, player)).toBe(WELCOME - 50 * COIN);
  });

  it("refuses to reuse a key for a different bet", async () => {
    const player = await newAccount(a);
    const key = newKey();

    await placeBet(a, player, 10 * COIN, key);
    const reused = await settle(placeBet(a, player, 4000 * COIN, key));

    expect(reused.ok).toBe(false);
    if (!reused.ok) expect(reused.error).toMatch(/idempotency_key_reused/);
    expect(await balance(a, player)).toBe(WELCOME - 10 * COIN);
  });
});

describe("cheat: a bet larger than the balance", () => {
  it("is refused and changes nothing", async () => {
    const player = await newAccount(a);

    const result = await settle(placeBet(a, player, WELCOME + 1, newKey()));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/insufficient_balance/);
    expect(await balance(a, player)).toBe(WELCOME);
    expect(await ledgerRows(a, player)).toHaveLength(1);
  });

  it("allows betting exactly the whole balance, then nothing more", async () => {
    const player = await newAccount(a);

    await placeBet(a, player, WELCOME, newKey());
    const next = await settle(placeBet(a, player, 1, newKey()));

    expect(await balance(a, player)).toBe(0);
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error).toMatch(/insufficient_balance/);
  });
});

describe("cheat: two requests arriving simultaneously", () => {
  it("lets only one of two bets through when both together exceed the balance", async () => {
    const player = await newAccount(a);

    // Two different bets of 3,000 against a 5,000 balance, overlapping.
    await a.query("begin");
    await placeBet(a, player, 3000 * COIN, newKey());
    const other = settle(placeBet(b, player, 3000 * COIN, newKey()));
    await sleep(300);
    await a.query("commit");

    const second = await other;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/insufficient_balance/);
    expect(await balance(a, player)).toBe(2000 * COIN);
  });

  it("survives twenty bets fired at once", async () => {
    const player = await newAccount(a);
    const clients = await Promise.all(Array.from({ length: 20 }, connect));

    try {
      const results = await Promise.all(
        clients.map((c) => settle(placeBet(c, player, 1000 * COIN, newKey()))),
      );
      // 5,000 balance / 1,000 per bet = exactly five can succeed.
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(await balance(a, player)).toBe(0);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("cheat: a balance that goes negative", () => {
  it("refuses a negative bet, which would otherwise print coins", async () => {
    const player = await newAccount(a);

    const result = await settle(placeBet(a, player, -1000 * COIN, newKey()));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid_amount/);
    expect(await balance(a, player)).toBe(WELCOME);
  });

  it("refuses a zero bet", async () => {
    const player = await newAccount(a);

    const result = await settle(placeBet(a, player, 0, newKey()));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid_amount/);
  });

  it("blocks a ledger line written straight into the table, skipping the checks", async () => {
    const player = await newAccount(a);

    const result = await settle(
      a.query(
        "insert into public.ledger (account_id, amount, kind, idempotency_key) values ($1, $2, 'bet', $3)",
        [player, -(WELCOME + 1), newKey()],
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/negative_balance/);
    expect(await balance(a, player)).toBe(WELCOME);
  });

  it("blocks two direct writes that only go negative together", async () => {
    const player = await newAccount(a);

    await a.query("begin");
    await a.query(
      "insert into public.ledger (account_id, amount, kind, idempotency_key) values ($1, $2, 'bet', $3)",
      [player, -3000 * COIN, newKey()],
    );
    const other = settle(
      b.query(
        "insert into public.ledger (account_id, amount, kind, idempotency_key) values ($1, $2, 'bet', $3)",
        [player, -3000 * COIN, newKey()],
      ),
    );
    await sleep(300);
    await a.query("commit");

    const second = await other;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/negative_balance/);
    expect(await balance(a, player)).toBe(2000 * COIN);
  });
});

describe("cheat: rewriting history", () => {
  it("refuses to edit a ledger line", async () => {
    const player = await newAccount(a);

    const result = await settle(
      a.query("update public.ledger set amount = amount * 100 where account_id = $1", [player]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ledger_is_append_only/);
    expect(await balance(a, player)).toBe(WELCOME);
  });

  it("refuses to delete a ledger line", async () => {
    const player = await newAccount(a);
    await placeBet(a, player, 100 * COIN, newKey());

    const result = await settle(
      a.query("delete from public.ledger where account_id = $1 and kind = 'bet'", [player]),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ledger_is_append_only/);
    expect(await balance(a, player)).toBe(WELCOME - 100 * COIN);
  });
});
