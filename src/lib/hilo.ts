// Hilo maths, for showing odds during a round and checking cards after one.
//
// PLACEHOLDER (ROADMAP session 08, Hilo part 1): every function throws, so
// each test in tests/cheat/hilo*.test.ts fails on its own until the real
// maths is written in part 2.
//
// This file never decides a result. Real cards and payouts come from the
// database (supabase/migrations/..._hilo.sql). The two copies must agree
// exactly; tests/cheat/hilo.test.ts checks.
//
//   k            = fair number x 2^32, a whole number from 0 to 2^32 - 1
//   card         = k x 52 / 2^32, rounded down: 0 to 51
//   rank         = card / 4, rounded down: 0 (Ace, low) to 12 (King, high)
//   suit         = card mod 4, for looks only
//   "higher"     = higher or same; "lower" = lower or same. A guess that
//                  can't lose (higher on an Ace, lower on a King) is refused.
//   a right guess multiplies by 2^32 / (how many of the 2^32 numbers win)
//   cash out pays bet x 0.99 x every multiplier, rounded down, at most
//   bet x 1,000,000 (the house edge is taken once, at the end)

export const CARDS = 52;
export const RANKS = 13;
export const MAX_CARDS = 64; // the most one spin's fair numbers can give
export const MAX_MULTIPLIER = 100_000_000; // 1,000,000.00x, in hundredths
export const RETURN_PERCENT = 99;

export type HiloGuess = "higher" | "lower";

function notYet(): never {
  throw new Error("hilo maths not written yet");
}

export function cardFromNumber(fairNumber: number): number {
  void fairNumber;
  return notYet();
}

export function rankOf(card: number): number {
  void card;
  return notYet();
}

export function suitOf(card: number): number {
  void card;
  return notYet();
}

// How many of the 2^32 fair numbers make this guess right, or null when the
// guess isn't allowed (bad rank, bad guess, or it can't lose).
export function winCount(rank: number, guess: string): number | null {
  void rank;
  void guess;
  return notYet();
}

export function isRight(rank: number, guess: HiloGuess, nextRank: number): boolean {
  void rank;
  void guess;
  void nextRank;
  return notYet();
}

// The multiplier so far, in hundredths, rounded down. counts holds
// winCount for every right guess.
export function multiplierHundredths(counts: number[]): number {
  void counts;
  return notYet();
}

// What cashing out pays, in hundredths of a coin.
export function payoutUnits(amount: number, counts: number[]): number {
  void amount;
  void counts;
  return notYet();
}
