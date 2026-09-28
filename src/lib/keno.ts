// Keno maths, for showing the pay table and checking a draw after a bet.
//
// This file never decides a result. Real draws and payouts come from the
// database (supabase/migrations/..._keno.sql, public.play_keno). The two
// copies must agree exactly; tests/cheat/keno.test.ts checks.
//
//   the draw     = 10 fair numbers. Each picks from the numbers still left
//                  (lowest first): position = floor(number x how many are
//                  left). So the first picks from 40, the last from 31.
//   picks        = 1 to 10 different numbers from 1 to 40
//   hits         = how many picks were drawn
//   a round pays   bet x PAYTABLE[picks][hits], rounded down
// Multipliers are rounded down to 0.01x, so each pick count returns just
// under 99%: a house edge between 1.00% and 1.22%, exact figures from
// returnPercent.

export const NUMBERS = 40;
export const DRAWN = 10;
export const MAX_PICKS = 10;

// PAYTABLE[picks][hits], in hundredths: 396 means 3.96x.
export const PAYTABLE: Record<number, number[]> = {
  1: [0, 396],
  2: [0, 147, 735],
  3: [0, 0, 383, 3835],
  4: [0, 0, 178, 1192, 5963],
  5: [0, 0, 84, 505, 3370, 8426],
  6: [0, 0, 0, 278, 1854, 9274, 23187],
  7: [0, 0, 0, 168, 842, 4213, 16852, 42131],
  8: [0, 0, 0, 0, 498, 3118, 14966, 49888, 124720],
  9: [0, 0, 0, 0, 284, 1518, 7592, 28470, 75922, 189805],
  10: [0, 0, 0, 0, 166, 833, 4165, 16662, 55543, 138857, 277715],
};

// Ways to choose k things from n, exactly.
function choose(n: number, k: number): bigint {
  if (k < 0 || k > n) return BigInt(0);
  let r = BigInt(1);
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

// The chance of exactly `hits` hits with `picks` picks, as a fraction.
export function hitChance(picks: number, hits: number): number {
  return Number(choose(picks, hits) * choose(NUMBERS - picks, DRAWN - hits)) / Number(choose(NUMBERS, DRAWN));
}

// What a pick count pays back on average, in percent. Worked out exactly.
export function returnPercent(picks: number): number {
  const table = PAYTABLE[picks];
  let paid = BigInt(0);
  for (let hits = 0; hits <= picks; hits++) {
    paid += choose(picks, hits) * choose(NUMBERS - picks, DRAWN - hits) * BigInt(table[hits]);
  }
  // Multipliers are hundredths, so this is already a percentage.
  const scale = BigInt(1_000_000_000);
  return Number((paid * scale) / choose(NUMBERS, DRAWN)) / 1_000_000_000;
}

export function kenoDraw(fairNumbers: number[]): number[] {
  const left = Array.from({ length: NUMBERS }, (_, i) => i + 1);
  return fairNumbers.slice(0, DRAWN).map((n) => left.splice(Math.floor(n * left.length), 1)[0]);
}

export function countHits(picks: number[], drawn: number[]): number {
  const set = new Set(drawn);
  return picks.filter((p) => set.has(p)).length;
}

export function validPicks(picks: number[]): boolean {
  return (
    Array.isArray(picks) &&
    picks.length >= 1 &&
    picks.length <= MAX_PICKS &&
    picks.every((p) => Number.isInteger(p) && p >= 1 && p <= NUMBERS) &&
    new Set(picks).size === picks.length
  );
}

// The multiplier in hundredths, or null when there is no such line.
export function kenoMultiplier(picks: number, hits: number): number | null {
  const table = PAYTABLE[picks];
  if (!table || !Number.isInteger(hits) || hits < 0 || hits > picks) return null;
  return table[hits];
}

// What a round pays, in hundredths. BigInt so no rounding creeps in.
export function payoutUnits(amount: number, picks: number, hits: number): number {
  const m = kenoMultiplier(picks, hits);
  if (m === null) return 0;
  return Number((BigInt(amount) * BigInt(m)) / BigInt(100));
}
