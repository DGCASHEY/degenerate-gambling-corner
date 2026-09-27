import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DesignSystem from "./page";
import { formatSignedCoins } from "../../components/ui/format";

describe("design system gallery", () => {
  const html = renderToStaticMarkup(<DesignSystem />);

  it.each([
    "Colour tokens",
    "Type scale",
    "Spacing scale",
    "Buttons",
    "Inputs",
    "Badges",
    "Cards",
    "Table",
    "Live feed row",
    "Bet panel shell",
  ])("shows the %s section", (title) => {
    expect(html).toContain(title);
  });

  it("shows incognito players as Incognito, not by name", () => {
    expect(html).toContain("Incognito");
  });
});

describe("signed coin amounts", () => {
  it("never shows a loss without a minus sign", () => {
    expect(formatSignedCoins(-250)).toBe("−250.00");
    expect(formatSignedCoins(9.8)).toBe("+9.80");
    expect(formatSignedCoins(0)).toBe("0.00");
  });
});
