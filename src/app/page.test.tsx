import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { games } from "../lib/games";
import { HomeView } from "./home-view";

vi.mock("../lib/supabase/server", () => ({
  currentUserId: vi.fn(async () => {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set.");
  }),
}));

describe("homepage", () => {
  it("offers sign-in and sign-up to someone signed out", () => {
    const html = renderToStaticMarkup(<HomeView player={null} />);
    expect(html).toContain("Degenerate Gambling Corner");
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/signup"');
  });

  it("shows a signed-in player their name and ledger balance", () => {
    const html = renderToStaticMarkup(<HomeView player={{ username: "deboss", coins: 6200 }} />);
    expect(html).toContain("deboss");
    expect(html).toContain("6,200.00");
    expect(html).not.toContain('href="/signup"');
  });

  it("lists every game, and unbuilt ones say so", () => {
    const html = renderToStaticMarkup(<HomeView player={null} />);
    for (const game of games) expect(html).toContain(game.name.replace("'", "&#x27;"));
    const unbuilt = games.filter((g) => !g.href).length;
    expect(html.split("Not built yet").length - 1).toBe(unbuilt);
  });

  it("links the Fairness card to the verifier", () => {
    const html = renderToStaticMarkup(<HomeView player={null} />);
    expect(html).toContain('href="/fairness"');
  });

  it("says 18+ and that nothing is worth money", () => {
    const html = renderToStaticMarkup(<HomeView player={null} />);
    expect(html).toContain("18+");
    expect(html).toContain("Nothing here can be bought, won or cashed out");
  });

  it("falls back to the signed-out page when Supabase is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: Home } = await import("./page");
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="/signup"');
  });
});
