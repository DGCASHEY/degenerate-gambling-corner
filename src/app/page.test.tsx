import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";

describe("holding page", () => {
  it("shows the site name and nothing else", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain("Degenerate Gambling Corner");
  });
});
