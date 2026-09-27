"use client";

import { useState } from "react";

type Theme = "system" | "light" | "dark";

const options: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Gallery-only preview switch. Not remembered between visits.
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("system");

  function choose(next: Theme) {
    setTheme(next);
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
  }

  return (
    <div
      role="group"
      aria-label="Preview theme"
      className="flex rounded-md border border-border bg-inset p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={theme === option.value}
          onClick={() => choose(option.value)}
          className="rounded-sm px-3 py-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg aria-pressed:bg-surface aria-pressed:text-fg aria-pressed:ring-1 aria-pressed:ring-border-strong"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
