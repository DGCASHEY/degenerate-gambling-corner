"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { afterRound, startAuto, type AdjustRule, type AutoSettings, type StopReason } from "../../lib/auto-bet";
import { Button } from "./button";
import { formatSignedUnits, formatUnits, parseCoins } from "./format";
import { Field, Input, SegmentedControl } from "./input";

// What the game hands back after the server settles one bet. Amounts are
// whole hundredths of a coin.
export type SettledBet = { amount: number; payout: number; balance: number };
export type BetOutcome = { ok: true; bet: SettledBet } | { ok: false; error: string };

type BetPanelProps = {
  // Unique per page, so two panels' fields stay separate.
  id: string;
  // Game-specific settings (target, risk level, rows ...). Goes above the bet button.
  controls?: ReactNode;
  // The game itself: dice track, wheel, board. Takes the big area.
  stage: ReactNode;
  // Sends one bet to the server and waits for the result. Leave it out and
  // the panel is a lifeless demo (the /design gallery).
  onBet?: (amount: number) => Promise<BetOutcome>;
  // Coins gained if this amount wins, for the readout. null: the game's
  // settings aren't valid yet, so betting is switched off. Leave it out for
  // games where a win can pay several amounts (Wheel, Keno); the readout
  // then points at the game's pay table.
  profitOnWin?: (amount: number) => number | null;
  // The game's own keys, e.g. { d: flip }. Space, A and S belong to the panel.
  shortcuts?: Record<string, { label: string; run: () => void }>;
  // Lets the game lock its own controls while Auto runs.
  onRunningChange?: (running: boolean) => void;
};

type Mode = "manual" | "auto";
type RuleKind = AdjustRule["kind"];

// Stops the key handler from acting while the player types in a box.
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function stopText(reason: StopReason | "error" | "pressed", bets: number, net: number, detail = ""): string {
  const summary = `${bets.toLocaleString("en-US")} ${bets === 1 ? "bet" : "bets"}, net ${formatSignedUnits(net)}.`;
  switch (reason) {
    case "count":
      return `Done. ${summary}`;
    case "win_limit":
      return `Stopped: you hit your win limit. ${summary} Leaving while ahead is rarer than it should be.`;
    case "loss_limit":
      return `Stopped: you hit your loss limit. ${summary} That is what the limit is for.`;
    case "cant_afford":
      return `Stopped: the next bet would be ${detail} and you don't have that. ${summary}`;
    case "pressed":
      return `Stopped. ${summary}`;
    case "error":
      return `Stopped: ${detail} ${summary}`;
  }
}

function RuleField({
  id,
  label,
  kind,
  by,
  disabled,
  onKind,
  onBy,
}: {
  id: string;
  label: string;
  kind: RuleKind;
  by: string;
  disabled: boolean;
  onKind: (kind: RuleKind) => void;
  onBy: (by: string) => void;
}) {
  const invalid = kind === "multiply" && parseMultiplier(by) === null;
  return (
    <Field id={`${id}-by`} label={label} error={invalid ? "A multiplier from 0.01 to 100." : undefined}>
      <div className="flex gap-2">
        <div className="flex-1">
          <SegmentedControl
            name={`${id}-kind`}
            label={label}
            value={kind}
            onChange={(v) => onKind(v as RuleKind)}
            disabled={disabled}
            options={[
              { value: "reset", label: "Reset" },
              { value: "multiply", label: "Multiply" },
            ]}
          />
        </div>
        <Input
          id={`${id}-by`}
          numeric
          inputMode="decimal"
          value={by}
          onChange={(e) => onBy(e.target.value)}
          disabled={disabled || kind === "reset"}
          invalid={invalid}
          suffix="×"
          className="w-24"
        />
      </div>
    </Field>
  );
}

function parseMultiplier(typed: string): number | null {
  if (!/^\s*\d{1,3}(\.\d{1,4})?\s*$/.test(typed)) return null;
  const by = Number(typed);
  return by >= 0.01 && by <= 100 ? by : null;
}

// An empty box means no limit.
function parseLimit(typed: string): number | null | undefined {
  if (typed.trim() === "") return null;
  const units = parseCoins(typed);
  return units === null || units === 0 ? undefined : units;
}

/*
  The frame every Original sits in. Nothing here decides or calculates a
  result: each bet goes to the server through onBet, and Auto only reads
  what came back to choose the next amount and when to stop.
*/
export function BetPanel({ id, controls, stage, onBet, profitOnWin, shortcuts, onRunningChange }: BetPanelProps) {
  const [mode, setMode] = useState<Mode>("manual");
  const [amountText, setAmountText] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const [count, setCount] = useState("0");
  const [onWin, setOnWin] = useState<RuleKind>("reset");
  const [onWinBy, setOnWinBy] = useState("2");
  const [onLoss, setOnLoss] = useState<RuleKind>("reset");
  const [onLossBy, setOnLossBy] = useState("2");
  const [stopUp, setStopUp] = useState("");
  const [stopDown, setStopDown] = useState("");
  const [progress, setProgress] = useState<{ bets: number; net: number } | null>(null);

  const stopRequested = useRef(false);

  const amount = parseCoins(amountText);
  const amountValid = amount !== null && amount >= 1;
  const profit = amountValid && profitOnWin ? profitOnWin(amount) : null;

  const countValue = /^\s*\d{1,7}\s*$/.test(count) ? Number(count) : null;
  const winBy = parseMultiplier(onWinBy);
  const lossBy = parseMultiplier(onLossBy);
  const up = parseLimit(stopUp);
  const down = parseLimit(stopDown);
  const autoValid =
    countValue !== null &&
    (onWin === "reset" || winBy !== null) &&
    (onLoss === "reset" || lossBy !== null) &&
    up !== undefined &&
    down !== undefined;

  const live = Boolean(onBet);
  const canBet = live && amountValid && (!profitOnWin || profit !== null) && !busy;
  const locked = busy || running;

  useEffect(() => onRunningChange?.(running), [running, onRunningChange]);

  const setAmount = (units: number) => setAmountText(formatUnits(units).replace(/,/g, ""));
  const halve = () => amountValid && setAmount(Math.max(1, Math.floor(amount / 2)));
  const double = () => amountValid && setAmount(amount * 2);

  const placeOne = useCallback(async () => {
    if (!onBet || !canBet) return;
    setBusy(true);
    setMessage(null);
    const outcome = await onBet(amount!);
    if (!outcome.ok) setMessage({ tone: "error", text: outcome.error });
    setBusy(false);
  }, [onBet, canBet, amount]);

  const runAuto = useCallback(async () => {
    if (!onBet || !canBet || !autoValid) return;
    const settings: AutoSettings = {
      baseAmount: amount!,
      onWin: onWin === "reset" ? { kind: "reset" } : { kind: "multiply", by: winBy! },
      onLoss: onLoss === "reset" ? { kind: "reset" } : { kind: "multiply", by: lossBy! },
      stopWhenUpBy: up ?? null,
      stopWhenDownBy: down ?? null,
      bets: countValue!,
    };

    stopRequested.current = false;
    setRunning(true);
    setMessage(null);
    let state = startAuto(settings);
    setProgress({ bets: 0, net: 0 });

    for (;;) {
      const outcome = await onBet(state.amount);
      if (!outcome.ok) {
        setMessage({ tone: "error", text: stopText("error", state.betsPlaced, state.net, outcome.error) });
        break;
      }
      const next = afterRound(settings, state, outcome.bet, outcome.bet.balance);
      state = next.state;
      setProgress({ bets: state.betsPlaced, net: state.net });
      if (next.stop) {
        setMessage({ tone: "info", text: stopText(next.stop, state.betsPlaced, state.net, formatUnits(state.amount)) });
        break;
      }
      if (stopRequested.current) {
        setMessage({ tone: "info", text: stopText("pressed", state.betsPlaced, state.net) });
        break;
      }
      // A breath between rounds, so each result is visible.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    setRunning(false);
  }, [onBet, canBet, autoValid, amount, onWin, winBy, onLoss, lossBy, up, down, countValue]);

  const stopAuto = () => {
    stopRequested.current = true;
  };

  // Keyboard: Space bets (or starts/stops Auto), A halves, S doubles, plus
  // the game's own keys. Ignored while typing in a box or holding a key.
  const keys = useRef({ placeOne, runAuto, stopAuto, halve, double, mode, running, locked, shortcuts });
  keys.current = { placeOne, runAuto, stopAuto, halve, double, mode, running, locked, shortcuts };
  useEffect(() => {
    if (!live) return;
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = keys.current;
      const key = e.key.toLowerCase();
      if (key === " ") {
        e.preventDefault();
        if (k.mode === "manual") void k.placeOne();
        else if (k.running) k.stopAuto();
        else void k.runAuto();
      } else if (key === "a" && !k.locked) k.halve();
      else if (key === "s" && !k.locked) k.double();
      else if (k.shortcuts?.[key] && !k.locked) k.shortcuts[key].run();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live]);

  return (
    <div className="flex flex-col-reverse overflow-hidden rounded-lg border border-border bg-surface lg:flex-row">
      <aside className="flex w-full flex-col gap-4 border-t border-border p-4 lg:w-80 lg:shrink-0 lg:border-t-0 lg:border-r">
        <SegmentedControl
          name={`${id}-mode`}
          label="Betting mode"
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          disabled={locked}
          options={[
            { value: "manual", label: "Manual" },
            { value: "auto", label: "Auto" },
          ]}
        />

        <Field
          id={`${id}-amount`}
          label="Bet amount"
          hint="Play coins. Worth nothing."
          error={amountValid ? undefined : "An amount of at least 0.01, with up to two decimal places."}
        >
          <div className="flex gap-2">
            <Input
              id={`${id}-amount`}
              numeric
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={() => amountValid && setAmount(amount)}
              invalid={!amountValid}
              disabled={locked}
              className="flex-1"
            />
            <Button variant="secondary" size="md" aria-label="Halve bet (A)" onClick={halve} disabled={locked}>
              ½
            </Button>
            <Button variant="secondary" size="md" aria-label="Double bet (S)" onClick={double} disabled={locked}>
              2×
            </Button>
          </div>
        </Field>

        <div className="flex items-baseline justify-between gap-2 rounded-md bg-inset px-3 py-2">
          <span className="text-xs font-medium text-fg-muted">Net gain on win</span>
          {profitOnWin || !live ? (
            <span className="font-mono text-sm tabular-nums text-win" data-testid="net-on-win">
              {profit === null ? "—" : formatSignedUnits(profit)}
            </span>
          ) : (
            <span className="text-sm text-fg-muted" data-testid="net-on-win">
              Varies, see the table
            </span>
          )}
        </div>

        {controls}

        {mode === "auto" ? (
          <div className="flex flex-col gap-4">
            <Field
              id={`${id}-count`}
              label="Number of bets"
              hint="0 keeps going until you press stop or a limit hits."
              error={countValue === null ? "A whole number, 0 or more." : undefined}
            >
              <Input
                id={`${id}-count`}
                numeric
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                invalid={countValue === null}
                disabled={locked}
              />
            </Field>
            <RuleField id={`${id}-win`} label="On win" kind={onWin} by={onWinBy} disabled={locked} onKind={setOnWin} onBy={setOnWinBy} />
            <RuleField id={`${id}-loss`} label="On loss" kind={onLoss} by={onLossBy} disabled={locked} onKind={setOnLoss} onBy={setOnLossBy} />
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${id}-stop-win`} label="Stop when up by" error={up === undefined ? "An amount, or empty." : undefined}>
                <Input
                  id={`${id}-stop-win`}
                  numeric
                  inputMode="decimal"
                  placeholder="No limit"
                  value={stopUp}
                  onChange={(e) => setStopUp(e.target.value)}
                  invalid={up === undefined}
                  disabled={locked}
                />
              </Field>
              <Field id={`${id}-stop-loss`} label="Stop when down by" error={down === undefined ? "An amount, or empty." : undefined}>
                <Input
                  id={`${id}-stop-loss`}
                  numeric
                  inputMode="decimal"
                  placeholder="No limit"
                  value={stopDown}
                  onChange={(e) => setStopDown(e.target.value)}
                  invalid={down === undefined}
                  disabled={locked}
                />
              </Field>
            </div>
          </div>
        ) : null}

        {mode === "manual" ? (
          <Button size="lg" fullWidth onClick={() => void placeOne()} disabled={!canBet}>
            {busy ? "Rolling…" : "Place bet"}
          </Button>
        ) : running ? (
          <Button size="lg" fullWidth variant="danger" onClick={stopAuto}>
            Stop auto bet
          </Button>
        ) : (
          <Button size="lg" fullWidth onClick={() => void runAuto()} disabled={!canBet || !autoValid}>
            Start auto bet
          </Button>
        )}

        {mode === "auto" && progress ? (
          <p className="font-mono text-xs tabular-nums text-fg-muted" aria-live="polite">
            {progress.bets.toLocaleString("en-US")} bets · net{" "}
            <span className={progress.net < 0 ? "text-loss" : progress.net > 0 ? "text-win" : ""}>
              {formatSignedUnits(progress.net)}
            </span>
          </p>
        ) : null}

        {message ? (
          <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-loss" : "text-fg-muted"}`}>
            {message.text}
          </p>
        ) : null}

        {live ? (
          <p className="text-xs text-fg-subtle">
            Keys: <kbd className="font-mono">Space</kbd> bet · <kbd className="font-mono">A</kbd> half ·{" "}
            <kbd className="font-mono">S</kbd> double
            {Object.entries(shortcuts ?? {}).map(([key, s]) => (
              <span key={key}>
                {" "}
                · <kbd className="font-mono">{key.toUpperCase()}</kbd> {s.label}
              </span>
            ))}
          </p>
        ) : null}
      </aside>

      <div className="flex min-h-72 flex-1 items-center justify-center bg-inset p-card">
        {stage}
      </div>
    </div>
  );
}
