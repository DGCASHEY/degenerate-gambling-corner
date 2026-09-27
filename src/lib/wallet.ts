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
