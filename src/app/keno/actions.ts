"use server";

import { validPicks } from "../../lib/keno";
import { currentUserId } from "../../lib/supabase/server";
import { playKeno, type KenoRound } from "../../lib/wallet";

export type KenoBet = {
  // Whole hundredths of a coin.
  amount: number;
  // 1 to 10 different numbers from 1 to 40.
  picks: number[];
  // One per bet, made in the browser. Sending the same one twice gets the
  // first round back instead of a second bet.
  key: string;
};

export type KenoActionResult = { ok: true; round: KenoRound } | { ok: false; error: string };

const errors: Record<string, string> = {
  insufficient_balance: "You don't have enough coins for that bet. Lower it, or claim the faucet on your account page.",
  invalid_amount: "The bet has to be at least 0.01 coins.",
  invalid_picks: "Pick between 1 and 10 different numbers from 1 to 40.",
  idempotency_key_reused: "That bet was already sent with different numbers. Reload the page and try again.",
};

// Only checks the shape of the request. Every rule about coins and odds is
// enforced again by the database.
export async function playKenoAction(bet: KenoBet): Promise<KenoActionResult> {
  const player = await currentUserId();
  if (!player) return { ok: false, error: "You're signed out. Sign in again to keep playing." };

  if (!Array.isArray(bet.picks) || bet.picks.length === 0) {
    return { ok: false, error: "Pick at least one number first. Up to ten." };
  }
  if (
    !Number.isSafeInteger(bet.amount) ||
    !validPicks(bet.picks) ||
    typeof bet.key !== "string" ||
    bet.key.length < 8 ||
    bet.key.length > 100
  ) {
    return { ok: false, error: "That bet didn't make sense. Reload the page and try again." };
  }

  const result = await playKeno(player, bet.amount, bet.picks, bet.key);
  if (!result.ok) {
    return { ok: false, error: errors[result.code] ?? `The bet was refused: ${result.code}.` };
  }
  return { ok: true, round: result.round };
}
