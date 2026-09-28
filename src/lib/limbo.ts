// Limbo maths, for showing odds before a bet and checking a result after one.
//
// This file never decides a result. Real results and payouts come from the
// database (supabase/migrations/..._limbo.sql, public.play_limbo). The two
// copies must agree exactly; tests/cheat/limbo.test.ts checks.
//
// Targets and results are whole hundredths of a multiplier: 200 means 2.00x.
//   k            = fair number x 2^32, a whole number from 0 to 2^32 - 1
//   result       = 99 x 2^32 / (2^32 - k), rounded down (at least 0.99x)
//   a win        = result >= target, on floor(99 x 2^32 / target) numbers
//   a win pays   bet x target, rounded down (1% house edge)

export const MIN_TARGET = 101; // 1.01x, a 98.02% chance
export const MAX_TARGET = 100_000_000; // 1,000,000.00x
export const RETURN_PERCENT = 99;

const TWO_32 = BigInt(2) ** BigInt(32);
const TOP = BigInt(99) * TWO_32;

function validTarget(target: number): boolean {
  return Number.isInteger(target) && target >= MIN_TARGET && target <= MAX_TARGET;
}

export function limboResult(fairNumber: number): number {
  const k = BigInt(fairNumber * 2 ** 32);
  return Number(TOP / (TWO_32 - k));
}

// How many of the 2^32 fair numbers win, or null when the target isn't allowed.
export function winningNumbers(target: number): number | null {
  if (!validTarget(target)) return null;
  return Number(TOP / BigInt(target));
}

// What a win pays, in hundredths. BigInt so no rounding creeps in.
function winPayout(amount: number, target: number): number {
  return Number((BigInt(amount) * BigInt(target)) / BigInt(100));
}

// What a result pays, in hundredths. 0 on a loss or a target that isn't allowed.
export function payoutUnits(amount: number, target: number, result: number): number {
  if (!validTarget(target) || result < target) return 0;
  return winPayout(amount, target);
}

// Coins gained on a win (payout minus the bet), in hundredths.
export function profitOnWin(amount: number, target: number): number | null {
  return validTarget(target) ? winPayout(amount, target) - amount : null;
}

export function winChancePercent(target: number): number | null {
  const wins = winningNumbers(target);
  return wins === null ? null : (wins / 2 ** 32) * 100;
}
