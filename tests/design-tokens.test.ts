import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Colours live in src/app/globals.css and nowhere else. This test fails if
// any component or page sneaks in a raw colour or a Tailwind palette colour.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const forbidden = [
  { what: "a hex colour", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { what: "an rgb()/hsl() colour", pattern: /\b(rgba?|hsla?|oklch)\(/ },
  {
    what: "a Tailwind palette colour",
    pattern:
      /\b(bg|text|border|ring|fill|stroke|from|to|via|outline|divide|shadow)-(black|white|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/,
  },
];

describe("design tokens", () => {
  const files = sourceFiles(join(process.cwd(), "src"));

  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.slice(process.cwd().length + 1)} uses tokens only`, () => {
      const text = readFileSync(file, "utf8");
      for (const rule of forbidden) {
        const match = text.match(rule.pattern);
        expect(match, `found ${rule.what}: ${match?.[0]}`).toBeNull();
      }
    });
  }
});
