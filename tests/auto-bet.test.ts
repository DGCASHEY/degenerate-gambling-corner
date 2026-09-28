import { describe, expect, it } from "vitest";
import { afterRound, startAuto, type AutoSettings } from "../src/lib/auto-bet";

// The Auto tab's rules. They only choose how much the next bet is and when
// to stop. The server still decides every result.

const base: AutoSettings = {
  baseAmount: 100,
  onWin: { kind: "reset" },
  onLoss: { kind: "reset" },
  stopWhenUpBy: null,
  stopWhenDownBy: null,
  bets: 0,
};

const win = (amount: number) => ({ amount, payout: amount * 2 });
const loss = (amount: number) => ({ amount, payout: 0 });
const RICH = 1_000_000_000;

describe("auto bet", () => {
  it("starts at the base amount with nothing placed", () => {
    expect(startAuto(base)).toEqual({ amount: 100, betsPlaced: 0, net: 0 });
  });

  it("goes back to the base amount after a win or a loss when set to reset", () => {
    const s = { ...base, onLoss: { kind: "multiply", by: 2 } as const };
    let { state } = afterRound(s, startAuto(s), loss(100), RICH);
    expect(state.amount).toBe(200);
    ({ state } = afterRound(s, state, win(200), RICH));
    expect(state.amount).toBe(100);
  });

  it("multiplies after a loss", () => {
    const s = { ...base, onLoss: { kind: "multiply", by: 2 } as const };
    let state = startAuto(s);
    for (const expected of [200, 400, 800]) {
      ({ state } = afterRound(s, state, loss(state.amount), RICH));
      expect(state.amount).toBe(expected);
    }
  });

  it("multiplies after a win", () => {
    const s = { ...base, onWin: { kind: "multiply", by: 1.5 } as const };
    const { state } = afterRound(s, startAuto(s), win(100), RICH);
    expect(state.amount).toBe(150);
  });

  it("keeps amounts whole hundredths and never below one", () => {
    const s = { ...base, baseAmount: 3, onLoss: { kind: "multiply", by: 0.5 } as const };
    let { state } = afterRound(s, startAuto(s), loss(3), RICH);
    expect(state.amount).toBe(2); // 1.5 rounds to 2
    ({ state } = afterRound(s, state, loss(2), RICH));
    expect(state.amount).toBe(1);
    ({ state } = afterRound(s, state, loss(1), RICH));
    expect(state.amount).toBe(1); // 0.5 would be below the smallest bet
  });

  it("keeps a running total of won minus bet", () => {
    let state = startAuto(base);
    ({ state } = afterRound(base, state, win(100), RICH));
    ({ state } = afterRound(base, state, loss(100), RICH));
    ({ state } = afterRound(base, state, loss(100), RICH));
    expect(state).toMatchObject({ betsPlaced: 3, net: -100 });
  });

  it("stops after the chosen number of bets", () => {
    const s = { ...base, bets: 3 };
    let state = startAuto(s);
    let stop = null;
    for (let i = 0; i < 3; i++) ({ state, stop } = afterRound(s, state, loss(100), RICH));
    expect(stop).toBe("count");
    expect(state.betsPlaced).toBe(3);
  });

  it("keeps going with 0 bets set until something else stops it", () => {
    let state = startAuto(base);
    let stop = null;
    for (let i = 0; i < 500; i++) ({ state, stop } = afterRound(base, state, loss(100), RICH));
    expect(stop).toBeNull();
  });

  it("stops when up by the chosen amount or more", () => {
    const s = { ...base, stopWhenUpBy: 150 };
    let { state, stop } = afterRound(s, startAuto(s), win(100), RICH);
    expect(stop).toBeNull(); // up 100
    ({ state, stop } = afterRound(s, state, win(100), RICH));
    expect(stop).toBe("win_limit"); // up 200
    expect(state.net).toBe(200);
  });

  it("stops when down by the chosen amount or more", () => {
    const s = { ...base, stopWhenDownBy: 200 };
    let { state, stop } = afterRound(s, startAuto(s), loss(100), RICH);
    expect(stop).toBeNull();
    ({ state, stop } = afterRound(s, state, loss(100), RICH));
    expect(stop).toBe("loss_limit");
  });

  it("stops when the next bet costs more than the balance", () => {
    const s = { ...base, onLoss: { kind: "multiply", by: 2 } as const };
    const { stop } = afterRound(s, startAuto(s), loss(100), 150);
    expect(stop).toBe("cant_afford");
  });

  it("checks the bet count before anything else", () => {
    const s = { ...base, bets: 1, stopWhenDownBy: 100 };
    const { stop } = afterRound(s, startAuto(s), loss(100), 0);
    expect(stop).toBe("count");
  });
});
