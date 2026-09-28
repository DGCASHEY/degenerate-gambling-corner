// The Auto tab's rules: how much the next bet is, and when to stop.
//
// Nothing here decides or changes a result. Each round is still a normal
// bet sent to the server; these rules only read what came back. Amounts
// are whole hundredths of a coin, like the ledger.

export type AdjustRule = { kind: "reset" } | { kind: "multiply"; by: number };

export type AutoSettings = {
  baseAmount: number;
  onWin: AdjustRule;
  onLoss: AdjustRule;
  // null: no limit.
  stopWhenUpBy: number | null;
  stopWhenDownBy: number | null;
  // 0 keeps going until something else stops it.
  bets: number;
};

export type AutoState = {
  // The next bet.
  amount: number;
  betsPlaced: number;
  // Everything paid back minus everything bet, so far.
  net: number;
};

export type StopReason = "count" | "win_limit" | "loss_limit" | "cant_afford";

export function startAuto(settings: AutoSettings): AutoState {
  return { amount: settings.baseAmount, betsPlaced: 0, net: 0 };
}

function adjust(rule: AdjustRule, base: number, current: number): number {
  if (rule.kind === "reset") return base;
  return Math.max(1, Math.round(current * rule.by));
}

export function afterRound(
  settings: AutoSettings,
  state: AutoState,
  round: { amount: number; payout: number },
  balance: number,
): { state: AutoState; stop: StopReason | null } {
  const won = round.payout > 0;
  const next: AutoState = {
    amount: adjust(won ? settings.onWin : settings.onLoss, settings.baseAmount, round.amount),
    betsPlaced: state.betsPlaced + 1,
    net: state.net + round.payout - round.amount,
  };

  let stop: StopReason | null = null;
  if (settings.bets > 0 && next.betsPlaced >= settings.bets) stop = "count";
  else if (settings.stopWhenUpBy !== null && next.net >= settings.stopWhenUpBy) stop = "win_limit";
  else if (settings.stopWhenDownBy !== null && -next.net >= settings.stopWhenDownBy) stop = "loss_limit";
  else if (next.amount > balance) stop = "cant_afford";

  return { state: next, stop };
}
