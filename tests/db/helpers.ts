import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

// Coins are stored as whole hundredths: 1 coin = 100 units.
export const COIN = 100;
export const WELCOME = 5000 * COIN;
export const HOURLY = 200 * COIN;
export const DAILY = 1000 * COIN;

// Each call opens its own connection, like a separate web request would.
export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: inject("databaseUrl") });
  await client.connect();
  return client;
}

export function newKey(): string {
  return randomUUID();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Signs up a player the way Supabase does: a row in auth.users with the
// sign-up form's answers in raw_user_meta_data.
export async function newAccount(
  db: pg.Client,
  meta: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  const username = `u_${randomBytes(6).toString("hex")}`;
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
    [id, `${username}@example.test`, { username, age_confirmed: true, ...meta }],
  );
  return id;
}

export async function balance(db: pg.Client, account: string): Promise<number> {
  const { rows } = await db.query("select public.get_balance($1) as balance", [
    account,
  ]);
  return Number(rows[0].balance);
}

export async function ledgerRows(db: pg.Client, account: string) {
  const { rows } = await db.query(
    "select kind, amount::bigint as amount from public.ledger where account_id = $1 order by id",
    [account],
  );
  return rows.map((r) => ({ kind: r.kind as string, amount: Number(r.amount) }));
}

type BetResult = { ledgerId: number; balance: number; replayed: boolean };

export async function placeBet(
  db: pg.Client,
  account: string,
  amount: number,
  key: string,
): Promise<BetResult> {
  const { rows } = await db.query(
    "select * from public.place_bet($1, $2, $3)",
    [account, amount, key],
  );
  return {
    ledgerId: Number(rows[0].ledger_id),
    balance: Number(rows[0].balance),
    replayed: rows[0].replayed,
  };
}

type ClaimResult = BetResult & { amount: number };

export async function claimFaucet(
  db: pg.Client,
  account: string,
  tap: string,
  key: string,
): Promise<ClaimResult> {
  const { rows } = await db.query(
    "select * from public.claim_faucet($1, $2, $3)",
    [account, tap, key],
  );
  return {
    ledgerId: Number(rows[0].ledger_id),
    amount: Number(rows[0].amount),
    balance: Number(rows[0].balance),
    replayed: rows[0].replayed,
  };
}

// Runs a promise and reports whether it worked, without throwing.
export async function settle<T>(p: Promise<T>) {
  try {
    return { ok: true as const, value: await p };
  } catch (error) {
    return { ok: false as const, error: (error as Error).message };
  }
}
