// Wheel maths, for drawing the wheel and checking a landing after a bet.
//
// This file never decides a result. Real landings and payouts come from the
// database (supabase/migrations/..._wheel.sql, public.play_wheel). The two
// copies of the tables must agree exactly; tests/cheat/wheel.test.ts checks.
//
//   segment      = floor(fair number x 30), so 0 to 29, each equally likely
//   multiplier   = that risk level's table at that segment, in hundredths
//   a landing pays bet x multiplier, rounded down
// Each table adds up to 99 x 30, so every risk level returns exactly 99%:
// a 1% house edge.

export type WheelRisk = "low" | "medium" | "high";

export const SEGMENTS = 30;
export const RETURN_PERCENT = 99;

// Segment by segment, clockwise from the pointer. Order only changes how the
// wheel looks; the odds come from how many segments carry each multiplier.
// Low: 8 x 0, 15 x 1.20, 6 x 1.50, 1 x 2.70.
// Medium: 15 x 0, 6 x 1.50, 6 x 2.00, 2 x 3.00, 1 x 2.70.
// High: 29 x 0, 1 x 29.70.
export const WHEELS: Record<WheelRisk, number[]> = {
  low: [
    0, 120, 150, 120, 0, 120, 120, 150, 0, 120, 120, 150, 0, 120, 270, 120, 0, 120, 150, 120, 0, 120, 120, 150, 0,
    120, 150, 120, 0, 120,
  ],
  medium: [
    0, 150, 0, 200, 0, 150, 0, 300, 0, 200, 0, 150, 0, 200, 0, 270, 0, 150, 0, 200, 0, 300, 0, 150, 0, 200, 0, 150, 0,
    200,
  ],
  high: [2970, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export function isWheelRisk(risk: string): risk is WheelRisk {
  return risk === "low" || risk === "medium" || risk === "high";
}

export function wheelSegment(fairNumber: number): number {
  return Math.floor(fairNumber * SEGMENTS);
}

// The multiplier at a segment, in hundredths, or null when there isn't one.
export function wheelMultiplier(risk: WheelRisk, segment: number): number | null {
  if (!isWheelRisk(risk) || !Number.isInteger(segment) || segment < 0 || segment >= SEGMENTS) return null;
  return WHEELS[risk][segment];
}

// What a landing pays, in hundredths. BigInt so no rounding creeps in.
export function payoutUnits(amount: number, risk: WheelRisk, segment: number): number {
  const m = wheelMultiplier(risk, segment);
  if (m === null) return 0;
  return Number((BigInt(amount) * BigInt(m)) / BigInt(100));
}

// Each distinct multiplier on a wheel and its chance, highest first. Display only.
export function payTable(risk: WheelRisk): Array<{ multiplier: number; segments: number }> {
  const counts = new Map<number, number>();
  for (const m of WHEELS[risk]) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].map(([multiplier, segments]) => ({ multiplier, segments })).sort((x, y) => y.multiplier - x.multiplier);
}
