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

// ---------------------------------------------------------------------------
// Fairness: sealed secrets, client words and the spin counter
// ---------------------------------------------------------------------------

export type SeedStatus = {
  fingerprint: string;
  clientWord: string;
  nextSpin: number;
  // The secret that becomes live at the next rotation, sealed in advance.
  nextFingerprint: string;
};

// What the player is shown: never the live secret itself.
export async function seedStatus(db: pg.Client, account: string): Promise<SeedStatus> {
  const { rows } = await db.query("select * from public.seed_status($1)", [account]);
  return {
    fingerprint: rows[0].server_seed_hash,
    clientWord: rows[0].client_seed,
    nextSpin: Number(rows[0].next_spin),
    nextFingerprint: rows[0].next_server_seed_hash,
  };
}

export async function rotateSeed(db: pg.Client, account: string, word: string | null) {
  const { rows } = await db.query("select * from public.rotate_seed($1, $2)", [account, word]);
  const r = rows[0];
  return {
    revealed: {
      serverSeed: r.revealed_server_seed as string,
      fingerprint: r.revealed_server_seed_hash as string,
      clientWord: r.revealed_client_seed as string,
      spins: Number(r.revealed_spins),
    },
    next: {
      fingerprint: r.server_seed_hash as string,
      clientWord: r.client_seed as string,
      nextSpin: 0,
      nextFingerprint: r.next_server_seed_hash as string,
    },
  };
}

export async function takeSpin(db: pg.Client, account: string, count: number) {
  const { rows } = await db.query("select * from public.take_spin($1, $2)", [account, count]);
  return {
    seedPairId: Number(rows[0].seed_pair_id),
    spin: Number(rows[0].spin),
    numbers: rows[0].numbers as number[],
  };
}

export async function revealedSeeds(db: pg.Client, account: string) {
  const { rows } = await db.query("select * from public.revealed_seeds($1)", [account]);
  return rows.map((r) => ({
    serverSeed: r.server_seed as string,
    fingerprint: r.server_seed_hash as string,
    clientWord: r.client_seed as string,
    spins: Number(r.spins),
  }));
}

// The database's copy of the maths, called directly with chosen inputs.
export async function sqlNumbers(
  db: pg.Client,
  serverSeed: string,
  clientWord: string,
  spin: number,
  count: number,
): Promise<number[]> {
  const { rows } = await db.query("select public.fair_numbers($1, $2, $3, $4) as numbers", [
    serverSeed,
    clientWord,
    spin,
    count,
  ]);
  return rows[0].numbers;
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

export type DiceDirection = "under" | "over";

export type DiceResult = {
  roundId: number;
  seedPairId: number;
  spin: number;
  roll: number;
  won: boolean;
  payout: number;
  balance: number;
  replayed: boolean;
};

// target and roll are whole hundredths: 5000 means 50.00.
export async function playDice(
  db: pg.Client,
  account: string,
  amount: number,
  target: number,
  direction: string,
  key: string,
): Promise<DiceResult> {
  const { rows } = await db.query("select * from public.play_dice($1, $2, $3, $4, $5)", [
    account,
    amount,
    target,
    direction,
    key,
  ]);
  const r = rows[0];
  return {
    roundId: Number(r.round_id),
    seedPairId: Number(r.seed_pair_id),
    spin: Number(r.spin),
    roll: Number(r.roll),
    won: r.won,
    payout: Number(r.payout),
    balance: Number(r.balance),
    replayed: r.replayed,
  };
}

// ---------------------------------------------------------------------------
// Limbo
// ---------------------------------------------------------------------------

export type LimboResult = {
  roundId: number;
  seedPairId: number;
  spin: number;
  result: number;
  won: boolean;
  payout: number;
  balance: number;
  replayed: boolean;
};

// target and result are whole hundredths of a multiplier: 200 means 2.00x.
export async function playLimbo(
  db: pg.Client,
  account: string,
  amount: number,
  target: number,
  key: string,
): Promise<LimboResult> {
  const { rows } = await db.query("select * from public.play_limbo($1, $2, $3, $4)", [account, amount, target, key]);
  const r = rows[0];
  return {
    roundId: Number(r.round_id),
    seedPairId: Number(r.seed_pair_id),
    spin: Number(r.spin),
    result: Number(r.result),
    won: r.won,
    payout: Number(r.payout),
    balance: Number(r.balance),
    replayed: r.replayed,
  };
}

// ---------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------

export type WheelResult = {
  roundId: number;
  seedPairId: number;
  spin: number;
  segment: number;
  multiplier: number;
  won: boolean;
  payout: number;
  balance: number;
  replayed: boolean;
};

// segment is 0 to 29; multiplier is whole hundredths: 150 means 1.50x.
export async function playWheel(
  db: pg.Client,
  account: string,
  amount: number,
  risk: string,
  key: string,
): Promise<WheelResult> {
  const { rows } = await db.query("select * from public.play_wheel($1, $2, $3, $4)", [account, amount, risk, key]);
  const r = rows[0];
  return {
    roundId: Number(r.round_id),
    seedPairId: Number(r.seed_pair_id),
    spin: Number(r.spin),
    segment: r.segment,
    multiplier: r.multiplier,
    won: r.won,
    payout: Number(r.payout),
    balance: Number(r.balance),
    replayed: r.replayed,
  };
}

// ---------------------------------------------------------------------------
// Keno
// ---------------------------------------------------------------------------

export type KenoResult = {
  roundId: number;
  seedPairId: number;
  spin: number;
  drawn: number[];
  hits: number;
  multiplier: number;
  won: boolean;
  payout: number;
  balance: number;
  replayed: boolean;
};

// picks and drawn are numbers from 1 to 40; multiplier is whole hundredths.
export async function playKeno(
  db: pg.Client,
  account: string,
  amount: number,
  picks: number[],
  key: string,
): Promise<KenoResult> {
  const { rows } = await db.query("select * from public.play_keno($1, $2, $3, $4)", [account, amount, picks, key]);
  const r = rows[0];
  return {
    roundId: Number(r.round_id),
    seedPairId: Number(r.seed_pair_id),
    spin: Number(r.spin),
    drawn: r.drawn,
    hits: r.hits,
    multiplier: r.multiplier,
    won: r.won,
    payout: Number(r.payout),
    balance: Number(r.balance),
    replayed: r.replayed,
  };
}
