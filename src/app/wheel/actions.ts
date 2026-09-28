"use server";

import { isWheelRisk, type WheelRisk } from "../../lib/wheel";
import { currentUserId } from "../../lib/supabase/server";
import { playWheel, type WheelRound } from "../../lib/wallet";

export type WheelBet = {
  // Whole hundredths of a coin.
  amount: number;
  risk: WheelRisk;
  // One per bet, made in the browser. Sending the same one twice gets the
  // first round back instead of a second bet.
  key: string;
};

export type WheelActionResult = { ok: true; round: WheelRound } | { ok: false; error: string };

const errors: Record<string, string> = {
  insufficient_balance: "You don't have enough coins for that bet. Lower it, or claim the faucet on your account page.",
  invalid_amount: "The bet has to be at least 0.01 coins.",
  invalid_risk: "Pick low, medium or high.",
  idempotency_key_reused: "That bet was already sent with different numbers. Reload the page and try again.",
};

// Only checks the shape of the request. Every rule about coins and odds is
// enforced again by the database.
export async function playWheelAction(bet: WheelBet): Promise<WheelActionResult> {
  const player = await currentUserId();
  if (!player) return { ok: false, error: "You're signed out. Sign in again to keep playing." };

  if (
    !Number.isSafeInteger(bet.amount) ||
    typeof bet.risk !== "string" ||
    !isWheelRisk(bet.risk) ||
    typeof bet.key !== "string" ||
    bet.key.length < 8 ||
    bet.key.length > 100
  ) {
    return { ok: false, error: "That bet didn't make sense. Reload the page and try again." };
  }

  const result = await playWheel(player, bet.amount, bet.risk, bet.key);
  if (!result.ok) {
    return { ok: false, error: errors[result.code] ?? `The bet was refused: ${result.code}.` };
  }
  return { ok: true, round: result.round };
}
