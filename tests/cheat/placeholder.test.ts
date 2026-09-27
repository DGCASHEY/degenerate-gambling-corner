import { describe, expect, it } from "vitest";

// Real exploit tests start at Build session 04 (ledger/wallet). Until then
// this keeps `npm run cheat` green instead of failing with "no tests found".
describe("cheat suite", () => {
  it("has nothing to exploit yet", () => {
    expect(true).toBe(true);
  });
});
