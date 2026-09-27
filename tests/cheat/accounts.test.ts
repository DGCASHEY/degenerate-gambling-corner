import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COIN, connect, newAccount, newKey, settle } from "../db/helpers";

let db: pg.Client;

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => {
  await db.end();
});

async function account(id: string) {
  const { rows } = await db.query(
    "select show_in_feed, show_on_leaderboard, public_profile from public.accounts where id = $1",
    [id],
  );
  return rows[0];
}

// Runs one statement as a browser would (anon = logged out,
// authenticated = logged in) instead of as our server.
async function asBrowser(role: "anon" | "authenticated", sql: string, params: unknown[]) {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    return await settle(db.query(sql, params));
  } finally {
    await db.query("rollback");
  }
}

describe("cheat: signing up without the 18+ confirmation", () => {
  it("creates no account", async () => {
    const result = await settle(newAccount(db, { age_confirmed: false }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/age_not_confirmed/);
  });

  it("creates no account when the answer is missing", async () => {
    const result = await settle(newAccount(db, { age_confirmed: null }));
    expect(result.ok).toBe(false);
  });
});

describe("privacy switches", () => {
  it("start as: feed on, leaderboard on, public profile off", async () => {
    const player = await newAccount(db);
    expect(await account(player)).toEqual({
      show_in_feed: true,
      show_on_leaderboard: true,
      public_profile: false,
    });
  });

  it("can each be changed on their own", async () => {
    const player = await newAccount(db);
    await db.query("select public.set_privacy($1, false, true, true)", [player]);
    expect(await account(player)).toEqual({
      show_in_feed: false,
      show_on_leaderboard: true,
      public_profile: true,
    });
  });
});

describe("cheat: the browser touching the wallet directly", () => {
  for (const role of ["anon", "authenticated"] as const) {
    it(`${role} cannot place a bet`, async () => {
      const player = await newAccount(db);
      const result = await asBrowser(role, "select * from public.place_bet($1, $2, $3)", [
        player,
        1 * COIN,
        newKey(),
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });

    it(`${role} cannot claim the faucet`, async () => {
      const player = await newAccount(db);
      const result = await asBrowser(role, "select * from public.claim_faucet($1, 'hourly', $2)", [
        player,
        newKey(),
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });

    it(`${role} cannot write to the ledger`, async () => {
      const player = await newAccount(db);
      const result = await asBrowser(
        role,
        "insert into public.ledger (account_id, amount, kind, idempotency_key) values ($1, 100, 'faucet_hourly', $2)",
        [player, newKey()],
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });

    it(`${role} cannot flip someone's privacy switches`, async () => {
      const player = await newAccount(db);
      const result = await asBrowser(role, "select public.set_privacy($1, false, false, true)", [
        player,
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });
  }
});
