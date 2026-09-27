import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DAILY,
  HOURLY,
  WELCOME,
  balance,
  claimFaucet,
  connect,
  ledgerRows,
  newAccount,
  newKey,
  settle,
  sleep,
} from "../db/helpers";

// The faucet is where coins come from, so it is the obvious thing to farm.

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

// Pretends a claim happened some minutes ago (tests only; the table is
// append-only, so this is an insert, not an edit).
async function claimedMinutesAgo(player: string, kind: string, minutes: number, amount: number) {
  await a.query(
    `insert into public.ledger (account_id, amount, kind, idempotency_key, created_at)
     values ($1, $2, $3, $4, now() - make_interval(mins => $5))`,
    [player, amount, kind, newKey(), minutes],
  );
}

describe("cheat: the welcome grant", () => {
  it("gives a new account exactly 5,000 coins, once", async () => {
    const player = await newAccount(a);

    expect(await balance(a, player)).toBe(WELCOME);
    expect(await ledgerRows(a, player)).toEqual([{ kind: "welcome", amount: WELCOME }]);
  });

  it("cannot be granted a second time", async () => {
    const player = await newAccount(a);

    const result = await settle(
      a.query(
        "insert into public.ledger (account_id, amount, kind, idempotency_key) values ($1, $2, 'welcome', $3)",
        [player, WELCOME, newKey()],
      ),
    );

    expect(result.ok).toBe(false);
    expect(await balance(a, player)).toBe(WELCOME);
  });

  it("cannot be written with a made-up amount", async () => {
    const player = await newAccount(a);

    const result = await settle(
      a.query(
        "insert into public.ledger (account_id, amount, kind, idempotency_key) values ($1, $2, 'faucet_hourly', $3)",
        [player, 1_000_000_000, newKey()],
      ),
    );

    expect(result.ok).toBe(false);
    expect(await balance(a, player)).toBe(WELCOME);
  });
});

describe("cheat: farming the hourly tap", () => {
  it("pays 200 once, then refuses until the hour is up", async () => {
    const player = await newAccount(a);

    const first = await claimFaucet(a, player, "hourly", newKey());
    const again = await settle(claimFaucet(a, player, "hourly", newKey()));

    expect(first.amount).toBe(HOURLY);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/faucet_not_ready/);
    expect(await balance(a, player)).toBe(WELCOME + HOURLY);
  });

  it("pays once when two claims arrive at the same instant", async () => {
    const player = await newAccount(a);

    await a.query("begin");
    await claimFaucet(a, player, "hourly", newKey());
    const other = settle(claimFaucet(b, player, "hourly", newKey()));
    await sleep(300);
    await a.query("commit");

    const second = await other;
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/faucet_not_ready/);
    expect(await balance(a, player)).toBe(WELCOME + HOURLY);
  });

  it("treats a repeated request as the same claim", async () => {
    const player = await newAccount(a);
    const key = newKey();

    await claimFaucet(a, player, "hourly", key);
    const repeat = await claimFaucet(b, player, "hourly", key);

    expect(repeat.replayed).toBe(true);
    expect(await balance(a, player)).toBe(WELCOME + HOURLY);
  });

  it("is ready again after 60 minutes, not before", async () => {
    const early = await newAccount(a);
    await claimedMinutesAgo(early, "faucet_hourly", 59, HOURLY);
    const tooSoon = await settle(claimFaucet(a, early, "hourly", newKey()));
    expect(tooSoon.ok).toBe(false);

    const later = await newAccount(a);
    await claimedMinutesAgo(later, "faucet_hourly", 61, HOURLY);
    const ready = await claimFaucet(a, later, "hourly", newKey());
    expect(ready.amount).toBe(HOURLY);
  });
});

describe("cheat: farming the daily tap", () => {
  it("is a separate tap from the hourly one", async () => {
    const player = await newAccount(a);

    await claimFaucet(a, player, "hourly", newKey());
    const daily = await claimFaucet(a, player, "daily", newKey());

    expect(daily.amount).toBe(DAILY);
    expect(await balance(a, player)).toBe(WELCOME + HOURLY + DAILY);
  });

  it("pays 1,000 once, then refuses until 24 hours are up", async () => {
    const player = await newAccount(a);
    await claimFaucet(a, player, "daily", newKey());

    const again = await settle(claimFaucet(a, player, "daily", newKey()));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/faucet_not_ready/);

    const yesterday = await newAccount(a);
    await claimedMinutesAgo(yesterday, "faucet_daily", 23 * 60 + 59, DAILY);
    expect((await settle(claimFaucet(a, yesterday, "daily", newKey()))).ok).toBe(false);

    const dayAgo = await newAccount(a);
    await claimedMinutesAgo(dayAgo, "faucet_daily", 24 * 60 + 1, DAILY);
    expect((await claimFaucet(a, dayAgo, "daily", newKey())).amount).toBe(DAILY);
  });

  it("refuses a tap that does not exist", async () => {
    const player = await newAccount(a);

    const result = await settle(claimFaucet(a, player, "weekly", newKey()));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid_tap/);
  });
});
