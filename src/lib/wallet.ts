import { serverClient } from "./supabase/server";

// The website's only way into the wallet. Every function here calls a
// database function that does the real work inside one locked transaction
// (see supabase/migrations). Nothing here adds, subtracts or checks coins
// itself.

// The database stores whole hundredths: 1 coin = 100 units.
export const UNITS_PER_COIN = 100;

export function unitsToCoins(units: number): number {
  return units / UNITS_PER_COIN;
}

export type Account = {
  id: string;
  username: string;
  showInFeed: boolean;
  showOnLeaderboard: boolean;
  publicProfile: boolean;
};

export async function getAccount(id: string): Promise<Account | null> {
  const { data, error } = await serverClient()
    .from("accounts")
    .select("id, username, show_in_feed, show_on_leaderboard, public_profile")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    username: data.username,
    showInFeed: data.show_in_feed,
    showOnLeaderboard: data.show_on_leaderboard,
    publicProfile: data.public_profile,
  };
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const { count, error } = await serverClient()
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("username", username);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

// Balance in units, freshly summed from the ledger.
export async function getBalance(id: string): Promise<number> {
  const { data, error } = await serverClient().rpc("get_balance", { p_account: id });
  if (error) throw new Error(error.message);
  return Number(data);
}

export type FaucetStatus = { hourlyReadyAt: Date | null; dailyReadyAt: Date | null };

export async function getFaucetStatus(id: string): Promise<FaucetStatus> {
  const { data, error } = await serverClient()
    .rpc("faucet_status", { p_account: id })
    .single<{ hourly_ready_at: string | null; daily_ready_at: string | null }>();
  if (error) throw new Error(error.message);
  return {
    hourlyReadyAt: data.hourly_ready_at ? new Date(data.hourly_ready_at) : null,
    dailyReadyAt: data.daily_ready_at ? new Date(data.daily_ready_at) : null,
  };
}

export type FaucetTap = "hourly" | "daily";

// Returns the database's error code (e.g. "faucet_not_ready") instead of
// throwing, so the page can explain what happened.
export async function claimFaucet(
  id: string,
  tap: FaucetTap,
  idempotencyKey: string,
): Promise<{ ok: true; amount: number } | { ok: false; code: string }> {
  const { data, error } = await serverClient()
    .rpc("claim_faucet", { p_account: id, p_tap: tap, p_key: idempotencyKey })
    .single<{ amount: number }>();
  if (error) return { ok: false, code: error.message };
  return { ok: true, amount: Number(data.amount) };
}

export async function setPrivacy(
  id: string,
  settings: { showInFeed: boolean; showOnLeaderboard: boolean; publicProfile: boolean },
): Promise<void> {
  const { error } = await serverClient().rpc("set_privacy", {
    p_account: id,
    p_feed: settings.showInFeed,
    p_board: settings.showOnLeaderboard,
    p_profile: settings.publicProfile,
  });
  if (error) throw new Error(error.message);
}

export type DiceRound = {
  roundId: number;
  seedPairId: number;
  // Check it at /fairness once this secret is revealed.
  spin: number;
  // Whole hundredths, 0 (0.00) to 9999 (99.99).
  roll: number;
  won: boolean;
  payout: number;
  balance: number;
  replayed: boolean;
};

// One Dice round: the database takes the bet, rolls with the next spin,
// pays any win and remembers the round, all in one transaction. A repeated
// idempotency key hands back the first round. Returns the database's error
// code (e.g. "insufficient_balance") instead of throwing.
export async function playDice(
  id: string,
  amount: number,
  target: number,
  direction: "under" | "over",
  idempotencyKey: string,
): Promise<{ ok: true; round: DiceRound } | { ok: false; code: string }> {
  const { data, error } = await serverClient()
    .rpc("play_dice", {
      p_account: id,
      p_amount: amount,
      p_target: target,
      p_direction: direction,
      p_key: idempotencyKey,
    })
    .single<{
      round_id: number;
      seed_pair_id: number;
      spin: number;
      roll: number;
      won: boolean;
      payout: number;
      balance: number;
      replayed: boolean;
    }>();
  if (error) return { ok: false, code: error.message };
  return {
    ok: true,
    round: {
      roundId: Number(data.round_id),
      seedPairId: Number(data.seed_pair_id),
      spin: Number(data.spin),
      roll: Number(data.roll),
      won: data.won,
      payout: Number(data.payout),
      balance: Number(data.balance),
      replayed: data.replayed,
    },
  };
}

export type LimboRound = {
  roundId: number;
  seedPairId: number;
  // Check it at /fairness once this secret is revealed.
  spin: number;
  // Whole hundredths of a multiplier: 200 means 2.00x.
  result: number;
  won: boolean;
  payout: number;
  balance: number;
  replayed: boolean;
};

// One Limbo round: the database takes the bet, draws the result with the
// next spin, pays any win and remembers the round, all in one transaction.
// A repeated idempotency key hands back the first round. Returns the
// database's error code (e.g. "insufficient_balance") instead of throwing.
export async function playLimbo(
  id: string,
  amount: number,
  target: number,
  idempotencyKey: string,
): Promise<{ ok: true; round: LimboRound } | { ok: false; code: string }> {
  const { data, error } = await serverClient()
    .rpc("play_limbo", {
      p_account: id,
      p_amount: amount,
      p_target: target,
      p_key: idempotencyKey,
    })
    .single<{
      round_id: number;
      seed_pair_id: number;
      spin: number;
      result: number;
      won: boolean;
      payout: number;
      balance: number;
      replayed: boolean;
    }>();
  if (error) return { ok: false, code: error.message };
  return {
    ok: true,
    round: {
      roundId: Number(data.round_id),
      seedPairId: Number(data.seed_pair_id),
      spin: Number(data.spin),
      result: Number(data.result),
      won: data.won,
      payout: Number(data.payout),
      balance: Number(data.balance),
      replayed: data.replayed,
    },
  };
}

export type WheelRound = {
  roundId: number;
  seedPairId: number;
  // Check it at /fairness once this secret is revealed.
  spin: number;
  // 0 to 29, clockwise from the pointer.
  segment: number;
  // Whole hundredths: 150 means 1.50x.
  multiplier: number;
  won: boolean;
  payout: number;
  balance: number;
  replayed: boolean;
};

// One Wheel round: the database takes the bet, lands the wheel with the next
// spin, pays any win and remembers the round, all in one transaction. A
// repeated idempotency key hands back the first round. Returns the
// database's error code (e.g. "insufficient_balance") instead of throwing.
export async function playWheel(
  id: string,
  amount: number,
  risk: "low" | "medium" | "high",
  idempotencyKey: string,
): Promise<{ ok: true; round: WheelRound } | { ok: false; code: string }> {
  const { data, error } = await serverClient()
    .rpc("play_wheel", {
      p_account: id,
      p_amount: amount,
      p_risk: risk,
      p_key: idempotencyKey,
    })
    .single<{
      round_id: number;
      seed_pair_id: number;
      spin: number;
      segment: number;
      multiplier: number;
      won: boolean;
      payout: number;
      balance: number;
      replayed: boolean;
    }>();
  if (error) return { ok: false, code: error.message };
  return {
    ok: true,
    round: {
      roundId: Number(data.round_id),
      seedPairId: Number(data.seed_pair_id),
      spin: Number(data.spin),
      segment: Number(data.segment),
      multiplier: Number(data.multiplier),
      won: data.won,
      payout: Number(data.payout),
      balance: Number(data.balance),
      replayed: data.replayed,
    },
  };
}

export type KenoRound = {
  roundId: number;
  seedPairId: number;
  // Check it at /fairness once this secret is revealed.
  spin: number;
  // Ten numbers from 1 to 40, in the order drawn.
  drawn: number[];
  hits: number;
  // Whole hundredths: 396 means 3.96x.
  multiplier: number;
  won: boolean;
  payout: number;
  balance: number;
  replayed: boolean;
};

// One Keno round: the database takes the bet, draws ten numbers with the
// next spin, pays any win and remembers the round, all in one transaction.
// A repeated idempotency key hands back the first round. Returns the
// database's error code (e.g. "insufficient_balance") instead of throwing.
export async function playKeno(
  id: string,
  amount: number,
  picks: number[],
  idempotencyKey: string,
): Promise<{ ok: true; round: KenoRound } | { ok: false; code: string }> {
  const { data, error } = await serverClient()
    .rpc("play_keno", {
      p_account: id,
      p_amount: amount,
      p_picks: picks,
      p_key: idempotencyKey,
    })
    .single<{
      round_id: number;
      seed_pair_id: number;
      spin: number;
      drawn: number[];
      hits: number;
      multiplier: number;
      won: boolean;
      payout: number;
      balance: number;
      replayed: boolean;
    }>();
  if (error) return { ok: false, code: error.message };
  return {
    ok: true,
    round: {
      roundId: Number(data.round_id),
      seedPairId: Number(data.seed_pair_id),
      spin: Number(data.spin),
      drawn: data.drawn.map(Number),
      hits: Number(data.hits),
      multiplier: Number(data.multiplier),
      won: data.won,
      payout: Number(data.payout),
      balance: Number(data.balance),
      replayed: data.replayed,
    },
  };
}
