import { formatCoins, formatMultiplier, formatSignedCoins } from "./format";

export type FeedBet = {
  // null means the player has "show in feed" switched off.
  player: string | null;
  game: string;
  wager: number;
  multiplier: number;
  // Net result: payout minus wager. Negative for a loss.
  profit: number;
  time: string;
};

// One row of the live bet feed. Purely a display of a settled bet the
// server has already decided.
export function FeedRow({ bet }: { bet: FeedBet }) {
  const tone =
    bet.profit > 0 ? "text-win" : bet.profit < 0 ? "text-loss" : "text-fg-muted";

  return (
    <li className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[1.4fr_1fr_1fr_0.8fr_1fr_4rem]">
      <span className="truncate">
        {bet.player ?? <span className="text-fg-subtle italic">Incognito</span>}
      </span>
      <span className="hidden text-fg-muted sm:block">{bet.game}</span>
      <span className="hidden text-right font-mono text-fg-muted tabular-nums sm:block">
        {formatCoins(bet.wager)}
      </span>
      <span className="text-right font-mono text-fg-muted tabular-nums">
        {formatMultiplier(bet.multiplier)}
      </span>
      <span className={`text-right font-mono font-semibold tabular-nums ${tone}`}>
        {formatSignedCoins(bet.profit)}
      </span>
      <span className="hidden text-right text-xs text-fg-subtle sm:block">
        {bet.time}
      </span>
    </li>
  );
}

export function FeedList({ bets }: { bets: FeedBet[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div
        aria-hidden
        className="hidden grid-cols-[1.4fr_1fr_1fr_0.8fr_1fr_4rem] gap-4 border-b border-border px-4 py-3 text-xs font-medium tracking-wide text-fg-subtle uppercase sm:grid"
      >
        <span>Player</span>
        <span>Game</span>
        <span className="text-right">Bet</span>
        <span className="text-right">Multiplier</span>
        <span className="text-right">Profit</span>
        <span className="text-right">When</span>
      </div>
      <ul>
        {bets.map((bet, i) => (
          <FeedRow key={i} bet={bet} />
        ))}
      </ul>
    </div>
  );
}
