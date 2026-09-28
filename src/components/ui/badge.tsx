import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "win" | "loss" | "warn";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-hover text-fg-muted",
  accent: "bg-accent-soft text-accent-text",
  win: "bg-win-soft text-win",
  loss: "bg-loss-soft text-loss",
  warn: "bg-warn-soft text-warn",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
