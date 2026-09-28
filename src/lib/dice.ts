// Dice maths, for showing odds before a bet and checking a roll after one.
//
// This file never decides a result. Real rolls and payouts come from the
// database (supabase/migrations/..._dice.sql, public.play_dice). The two
// copies must agree exactly; tests/cheat/dice.test.ts checks.
//
// Rolls and targets are whole hundredths: 5000 means 50.00.
//   roll         = floor(fair number x 10,000), so 0 to 9999
//   under T wins when roll < T  (T winning rolls)
//   over T wins when roll > T   (9999 - T winning rolls)
//   a win pays   bet x 9,900 / winning rolls, rounded down (1% house edge)

export type DiceDirection = "under" | "over";

export const ROLLS = 10_000;
export const MIN_WINNING_ROLLS = 1; // 0.01%
export const MAX_WINNING_ROLLS = 9_800; // 98%
export const RETURN_PERCENT = 99;
const PAYOUT_FACTOR = BigInt(9_900);

// How many of the 10,000 rolls win, or null when the bet isn't allowed.
export function winningRolls(target: number, direction: DiceDirection): number | null {
  if (!Number.isInteger(target)) return null;
  const rolls = direction === "under" ? target : direction === "over" ? 9_999 - target : null;
  if (rolls === null || rolls < MIN_WINNING_ROLLS || rolls > MAX_WINNING_ROLLS) return null;
  return rolls;
}

export function diceRoll(fairNumber: number): number {
  return Math.floor(fairNumber * ROLLS);
}

export function isWin(target: number, direction: DiceDirection, roll: number): boolean {
  return direction === "under" ? roll < target : roll > target;
}

// What a win pays, in hundredths. BigInt so no rounding creeps in.
function winPayout(amount: number, rolls: number): number {
  return Number((BigInt(amount) * PAYOUT_FACTOR) / BigInt(rolls));
}

// What a roll pays, in hundredths. 0 on a loss or a bet that isn't allowed.
export function payoutUnits(amount: number, target: number, direction: DiceDirection, roll: number): number {
  const rolls = winningRolls(target, direction);
  if (rolls === null || !isWin(target, direction, roll)) return 0;
  return winPayout(amount, rolls);
}

// Coins gained on a win (payout minus the bet), in hundredths.
export function profitOnWin(amount: number, target: number, direction: DiceDirection): number | null {
  const rolls = winningRolls(target, direction);
  if (rolls === null) return null;
  return winPayout(amount, rolls) - amount;
}

// For display only: 99 / win chance.
export function multiplier(target: number, direction: DiceDirection): number | null {
  const rolls = winningRolls(target, direction);
  return rolls === null ? null : (RETURN_PERCENT * 100) / rolls;
}

export function winChancePercent(target: number, direction: DiceDirection): number | null {
  const rolls = winningRolls(target, direction);
  return rolls === null ? null : rolls / 100;
}

// Flipping keeps the same winning rolls: under 49.50 <-> over 50.49.
export function flipTarget(target: number): number {
  return 9_999 - target;
}
