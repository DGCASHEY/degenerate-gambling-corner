import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BetPanel, type BetOutcome } from "./bet-panel";

// Session 07: Wheel and Keno pay several amounts, so they leave out
// profitOnWin. Their Place bet button must still switch on.

// The attribute itself, not the "disabled:" style classes.
const DISABLED = /\sdisabled=""/;

const onBet = async (): Promise<BetOutcome> => ({ ok: false, error: "not in this test" });

function placeBetButton(html: string): string {
  const button = /<button[^>]*>(?:(?!<\/button>).)*Place bet<\/button>/.exec(html)?.[0];
  if (!button) throw new Error("no Place bet button");
  return button;
}

describe("bet panel", () => {
  it("lets a game with one win amount bet, and shows that amount", () => {
    const html = renderToStaticMarkup(<BetPanel id="t" stage={null} onBet={onBet} profitOnWin={(a) => a} />);
    expect(placeBetButton(html)).not.toMatch(DISABLED);
    expect(html).toContain("+1.00");
  });

  it("switches betting off while that game's settings are invalid", () => {
    const html = renderToStaticMarkup(<BetPanel id="t" stage={null} onBet={onBet} profitOnWin={() => null} />);
    expect(placeBetButton(html)).toMatch(DISABLED);
  });

  it("lets a game with several win amounts bet, and points at its table", () => {
    const html = renderToStaticMarkup(<BetPanel id="t" stage={null} onBet={onBet} />);
    expect(placeBetButton(html)).not.toMatch(DISABLED);
    expect(html).toContain("Varies, see the table");
  });

  it("stays a lifeless demo with no onBet", () => {
    const html = renderToStaticMarkup(<BetPanel id="t" stage={null} />);
    expect(placeBetButton(html)).toMatch(DISABLED);
    expect(html).not.toContain("Varies");
  });
});
