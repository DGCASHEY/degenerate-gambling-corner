import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fairNumbers } from "../../src/lib/fairness";
import {
  MAX_CARDS,
  MAX_MULTIPLIER,
  cardFromNumber,
  isRight,
  multiplierHundredths,
  payoutUnits,
  rankOf,
  suitOf,
  winCount,
  type HiloGuess,
} from "../../src/lib/hilo";
import {
  COIN,
  HILO_COLUMNS,
  WELCOME,
  balance,
  cashOutHilo,
  connect,
  guessHilo,
  ledgerRows,
  newAccount,
  newKey,
  openHiloRound,
  placeBet,
  playDice,
  playLimbo,
  rotateSeed,
  seedStatus,
  settle,
  sleep,
  startHilo,
  type HiloRound,
} from "../db/helpers";

// Hilo, from ROADMAP session 08: the first game whose round stays open
// between clicks. A round is three kinds of row, all append-only: the start
// (bet + first card), one move per guess or skip, and at most one ending
// (cashed out or lost). Cards are 0 to 51: rank = card / 4 (0 Ace, low, to
// 12 King, high), suit = card mod 4. "higher" means higher or same, "lower"
// means lower or same; a guess that can't lose is refused. Cash out pays
// bet x 0.99 x every right guess's 2^32 / winCount, rounded down, at most
// bet x 1,000,000. 64 cards per round at most. While a round is open the
// player can't rotate their secret, because that would reveal every card
// still to come.
//
// These tests may peek at a round's upcoming cards: they run as the
// database's superuser, which can read the sealed secret. Real players
// can't, and "the next card never reaches the browser" checks that.

const N = 2 ** 32;

let a: pg.Client;
let b: pg.Client;

beforeAll(async () => {
  a = await connect();
  b = await connect();
});

afterAll(async () => {
  await a.end();
  await b.end();
});

// Runs one statement as someone other than the test's superuser, then undoes it.
async function as(role: "anon" | "authenticated", sql: string, params: unknown[] = []) {
  await a.query("begin");
  try {
    await a.query(`set local role ${role}`);
    return await settle(a.query(sql, params));
  } finally {
    await a.query("rollback");
  }
}

// Every card this round can ever deal, read from the sealed secret.
async function peekCards(roundId: number): Promise<number[]> {
  const { rows } = await a.query(
    `select s.server_seed, s.client_seed, r.spin
     from public.hilo_rounds r join public.seed_pairs s on s.id = r.seed_pair_id
     where r.id = $1`,
    [roundId],
  );
  const numbers = await fairNumbers(rows[0].server_seed, rows[0].client_seed, Number(rows[0].spin), MAX_CARDS);
  return numbers.map(cardFromNumber);
}

// The guess that wins (or loses) going from rank r to rank s, if there is one.
function rightGuess(r: number, s: number): HiloGuess | null {
  if (s >= r && r !== 0) return "higher";
  if (s <= r && r !== 12) return "lower";
  return null;
}

function wrongGuess(r: number, s: number): HiloGuess | null {
  if (s < r) return "higher";
  if (s > r) return "lower";
  return null;
}

function nextMove(round: HiloRound): number {
  return round.guesses.length + 1;
}

// Skips until a right (or wrong) guess is possible, then makes it.
async function play(db: pg.Client, player: string, round: HiloRound, want: "right" | "wrong"): Promise<HiloRound> {
  const cards = await peekCards(round.roundId);
  let view = round;
  for (;;) {
    const m = nextMove(view);
    const r = rankOf(cards[m - 1]);
    const s = rankOf(cards[m]);
    const guess = want === "right" ? rightGuess(r, s) : wrongGuess(r, s);
    if (guess) return guessHilo(db, player, view.roundId, m, guess, newKey());
    view = await guessHilo(db, player, view.roundId, m, "skip", newKey());
  }
}

// winCount for every right guess so far (open or cashed-out rounds).
function countsOf(round: HiloRound): number[] {
  return round.guesses.flatMap((g, i) => (g === "skip" ? [] : [winCount(rankOf(round.cards[i]), g)!]));
}

async function moveRows(roundId: number): Promise<number> {
  const { rows } = await a.query("select count(*)::int as n from public.hilo_moves where round_id = $1", [roundId]);
  return rows[0].n;
}

async function endingRows(roundId: number): Promise<number> {
  const { rows } = await a.query("select count(*)::int as n from public.hilo_endings where round_id = $1", [roundId]);
  return rows[0].n;
}

async function hiloRoundRows(account: string): Promise<number> {
  const { rows } = await a.query("select count(*)::int as n from public.hilo_rounds where account_id = $1", [account]);
  return rows[0].n;
}

// A round that is open with one right guess behind it, ready to cash out.
async function oneRightGuess(player: string, bet = 10 * COIN): Promise<HiloRound> {
  const round = await startHilo(a, player, bet, newKey());
  return play(a, player, round, "right");
}

describe("hilo: the maths", () => {
  it("turns a fair number into a card exactly", () => {
    expect(cardFromNumber(0)).toBe(0);
    // The edge between card 0 and card 1: 2^32 / 52 = 82,595,524.9...
    expect(cardFromNumber(82595524 / N)).toBe(0);
    expect(cardFromNumber(82595525 / N)).toBe(1);
    expect(cardFromNumber(0.5)).toBe(26);
    expect(cardFromNumber((N - 1) / N)).toBe(51);
  });

  it("gives every card a rank from Ace (0) to King (12) and a suit", () => {
    expect([rankOf(0), rankOf(3), rankOf(4), rankOf(51)]).toEqual([0, 0, 1, 12]);
    expect([suitOf(0), suitOf(5), suitOf(51)]).toEqual([0, 1, 3]);
  });

  it("counts winning numbers exactly for every guess", () => {
    // Each rank is 330,382,099 or 330,382,100 of the 2^32 numbers.
    expect(winCount(0, "lower")).toBe(330382100); // only another Ace
    expect(winCount(1, "higher")).toBe(3964585196);
    expect(winCount(6, "higher")).toBe(2312674697);
    expect(winCount(6, "lower")).toBe(2312674698);
    expect(winCount(11, "lower")).toBe(3964585197);
    expect(winCount(12, "higher")).toBe(330382099); // only another King
  });

  it("refuses a guess that can't lose, and anything that isn't a guess", () => {
    expect(winCount(0, "higher")).toBeNull(); // everything is an Ace or higher
    expect(winCount(12, "lower")).toBeNull(); // everything is a King or lower
    for (const [rank, guess] of [
      [-1, "higher"],
      [13, "lower"],
      [1.5, "higher"],
      [5, "skip"],
      [5, "sideways"],
      [5, ""],
    ] as const) {
      expect(winCount(rank, guess), `${rank} ${guess}`).toBeNull();
    }
  });

  it("counts the same rank as right both ways", () => {
    expect(isRight(6, "higher", 6)).toBe(true);
    expect(isRight(6, "lower", 6)).toBe(true);
    expect(isRight(6, "higher", 7)).toBe(true);
    expect(isRight(6, "higher", 5)).toBe(false);
    expect(isRight(6, "lower", 7)).toBe(false);
    expect(isRight(0, "lower", 0)).toBe(true);
    expect(isRight(0, "lower", 1)).toBe(false);
    expect(isRight(12, "higher", 11)).toBe(false);
  });

  it("works out the multiplier: 0.99 x every 2^32 / winCount, rounded down, at most 1,000,000x", () => {
    expect(multiplierHundredths([])).toBe(99);
    expect(multiplierHundredths([330382100])).toBe(1286); // 12.86x
    expect(multiplierHundredths([3964585196])).toBe(107);
    expect(multiplierHundredths([2312674697, 2312674698])).toBe(341);
    expect(multiplierHundredths([330382099, 330382099, 330382099])).toBe(217503);
    expect(multiplierHundredths(Array(6).fill(330382099))).toBe(MAX_MULTIPLIER);
  });

  it("pays bet x 0.99 x every multiplier exactly, rounded down, at most bet x 1,000,000", () => {
    // Not bet x the rounded multiplier: 100 coins x 12.8699... = 1,286.99.
    expect(payoutUnits(100 * COIN, [330382100])).toBe(128699);
    expect(payoutUnits(100 * COIN, [2312674697, 2312674698])).toBe(34144);
    expect(payoutUnits(1, [3964585196])).toBe(1);
    expect(payoutUnits(7, [330382099, 330382099, 330382099])).toBe(15225);
    expect(payoutUnits(COIN, Array(6).fill(330382099))).toBe(1_000_000 * COIN);
    expect(payoutUnits(100 * COIN, [])).toBe(0);
  });

  it("turns a fair number into a card the same way in the browser and the database", async () => {
    const samples = [0, 82595524 / N, 82595525 / N, 0.5, (N - 1) / N, 1234567 / N, 3999999999 / N, 2147483647 / N];
    for (const n of samples) {
      const { rows } = await a.query("select public.hilo_card($1::double precision) as card", [n]);
      expect(rows[0].card, String(n)).toBe(cardFromNumber(n));
    }
  });

  it("agrees with the database on every guess's winning count", async () => {
    for (let rank = 0; rank < 13; rank++) {
      for (const guess of ["higher", "lower"] as const) {
        const browser = winCount(rank, guess);
        const result = await settle(a.query("select public.hilo_win_count($1, $2)::bigint as n", [rank, guess]));
        if (browser === null) {
          expect(result.ok, `${rank} ${guess}`).toBe(false);
          if (!result.ok) expect(result.error).toMatch(/guess_cannot_lose/);
        } else {
          expect(result.ok, `${rank} ${guess}`).toBe(true);
          if (result.ok) expect(Number(result.value.rows[0].n)).toBe(browser);
        }
      }
    }
    for (const [rank, guess, error] of [
      [5, "skip", /invalid_guess/],
      [5, "sideways", /invalid_guess/],
      [13, "lower", /invalid_rank/],
      [-1, "higher", /invalid_rank/],
    ] as const) {
      const result = await settle(a.query("select public.hilo_win_count($1, $2)", [rank, guess]));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(error);
    }
  });

  it("agrees with the database on every right and wrong guess", async () => {
    const { rows } = await a.query(
      `select r, s, g, public.hilo_is_right(r, g, s) as right
       from generate_series(0, 12) r, generate_series(0, 12) s, unnest(array['higher', 'lower']) g`,
    );
    expect(rows).toHaveLength(13 * 13 * 2);
    for (const row of rows) expect(row.right, `${row.r} ${row.g} ${row.s}`).toBe(isRight(row.r, row.g, row.s));
  });

  it("agrees with the database on every multiplier and payout", async () => {
    for (const [amount, counts] of [
      [100 * COIN, [330382100]],
      [100 * COIN, [2312674697, 2312674698]],
      [1, [3964585196]],
      [7, [330382099, 330382099, 330382099]],
      [COIN, Array(6).fill(330382099)],
      [123457, [3964585196, 660764200, 2643056797, 1651910498]],
      [999_999_999, [4294967295, 4294967295]],
      [100 * COIN, []],
    ] as const) {
      const { rows } = await a.query(
        "select public.hilo_payout($1, $2::bigint[])::bigint as payout, public.hilo_multiplier($2::bigint[])::bigint as multiplier",
        [amount, counts],
      );
      expect(Number(rows[0].payout), String(counts)).toBe(payoutUnits(amount, [...counts]));
      expect(Number(rows[0].multiplier), String(counts)).toBe(multiplierHundredths([...counts]));
    }
  });
});

describe("hilo: a round", () => {
  it("takes the bet and deals one card, and nothing else", async () => {
    const player = await newAccount(a);
    const round = await startHilo(a, player, 10 * COIN, newKey());

    expect(round.state).toBe("open");
    expect(round.cards).toHaveLength(1);
    expect(round.cards[0]).toBeGreaterThanOrEqual(0);
    expect(round.cards[0]).toBeLessThanOrEqual(51);
    expect(round.guesses).toEqual([]);
    expect(round.multiplier).toBe(99);
    expect(round.payout).toBe(0);
    expect(round.balance).toBe(WELCOME - 10 * COIN);
    expect(round.cards[0]).toBe((await peekCards(round.roundId))[0]);

    const lines = await ledgerRows(a, player);
    expect(lines.map((l) => l.kind)).toEqual(["welcome", "bet"]);
  });

  it("pays bet x 0.99 x every right guess's multiplier on cash out, and ends the round", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    let round = await oneRightGuess(player, bet);
    round = await play(a, player, round, "right");
    expect(round.state).toBe("open");

    const counts = countsOf(round);
    expect(counts).toHaveLength(2);
    expect(round.multiplier).toBe(multiplierHundredths(counts));

    const cashed = await cashOutHilo(a, player, round.roundId, newKey());
    expect(cashed.state).toBe("cashed_out");
    expect(cashed.payout).toBe(payoutUnits(bet, counts));
    expect(cashed.balance).toBe(WELCOME - bet + cashed.payout);
    expect(await balance(a, player)).toBe(WELCOME - bet + cashed.payout);

    const lines = await ledgerRows(a, player);
    expect(lines.map((l) => l.kind)).toEqual(["welcome", "bet", "payout"]);
    expect(lines[2].amount).toBe(cashed.payout);
    expect(await endingRows(round.roundId)).toBe(1);
  });

  it("loses the bet on a wrong guess and pays nothing", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    const round = await oneRightGuess(player, bet);
    const lost = await play(a, player, round, "wrong");

    expect(lost.state).toBe("lost");
    expect(lost.payout).toBe(0);
    expect(lost.multiplier).toBe(0);
    expect(lost.balance).toBe(WELCOME - bet);
    expect(await balance(a, player)).toBe(WELCOME - bet);
    expect((await ledgerRows(a, player)).map((l) => l.kind)).toEqual(["welcome", "bet"]);
    expect(await endingRows(round.roundId)).toBe(1);
    expect(await openHiloRound(a, player)).toBeNull();
  });

  it("deals a new card on a skip and leaves the multiplier alone", async () => {
    const player = await newAccount(a);
    const round = await oneRightGuess(player);
    const cards = await peekCards(round.roundId);
    const m = nextMove(round);

    const skipped = await guessHilo(a, player, round.roundId, m, "skip", newKey());
    expect(skipped.state).toBe("open");
    expect(skipped.multiplier).toBe(round.multiplier);
    expect(skipped.guesses.at(-1)).toBe("skip");
    expect(skipped.cards).toEqual(cards.slice(0, m + 1));
  });

  it("deals the cards the secret says, and anyone can check them afterwards", async () => {
    const player = await newAccount(a);
    let round = await startHilo(a, player, COIN, newKey());
    round = await guessHilo(a, player, round.roundId, 1, "skip", newKey());
    round = await play(a, player, round, "right");
    round = await play(a, player, round, "wrong");
    expect(round.state).toBe("lost");

    const { revealed } = await rotateSeed(a, player, null);
    const numbers = await fairNumbers(revealed.serverSeed, revealed.clientWord, round.spin, MAX_CARDS);
    expect(round.cards).toEqual(numbers.slice(0, round.cards.length).map(cardFromNumber));
  });

  it("uses one new spin number per round, shared with the other games", async () => {
    const player = await newAccount(a);
    const before = (await seedStatus(a, player)).nextSpin;

    let round = await startHilo(a, player, COIN, newKey());
    expect(round.spin).toBe(before);
    round = await guessHilo(a, player, round.roundId, 1, "skip", newKey());
    round = await play(a, player, round, "right");
    // Moves deal from the round's own spin; they never take another.
    expect((await seedStatus(a, player)).nextSpin).toBe(before + 1);

    await play(a, player, round, "wrong");
    const dice = await playDice(a, player, COIN, 5000, "under", newKey());
    expect(dice.spin).toBe(before + 1);
  });

  it("comes back after a reload, exactly as it was", async () => {
    const player = await newAccount(a);
    expect(await openHiloRound(a, player)).toBeNull();

    const round = await oneRightGuess(player);
    const reloaded = await openHiloRound(b, player);
    expect(reloaded).not.toBeNull();
    expect({ ...reloaded!, replayed: false }).toEqual({ ...round, replayed: false });

    await cashOutHilo(a, player, round.roundId, newKey());
    expect(await openHiloRound(b, player)).toBeNull();
  });

  it("keeps its cards while other games are played", async () => {
    const player = await newAccount(a);
    const round = await startHilo(a, player, COIN, newKey());
    const cards = await peekCards(round.roundId);

    await playDice(a, player, COIN, 5000, "under", newKey());
    await playLimbo(a, player, COIN, 200, newKey());

    let view = round;
    for (let m = 1; m <= 3; m++) view = await guessHilo(a, player, round.roundId, m, "skip", newKey());
    expect(view.cards).toEqual(cards.slice(0, 4));
  });

  it("cashes out by itself at exactly bet x 1,000,000 when the multiplier reaches the top", async () => {
    const player = await newAccount(a);
    let capped: HiloRound | null = null;

    // Guess right whenever it pays 1.5x or more, skip otherwise. Reaches the
    // top in about 99 rounds out of 100, so 20 tries is all but certain.
    for (let attempt = 0; attempt < 20 && !capped; attempt++) {
      let view = await startHilo(a, player, COIN, newKey());
      const cards = await peekCards(view.roundId);
      while (view.state === "open") {
        const m = nextMove(view);
        const r = rankOf(cards[m - 1]);
        const s = rankOf(cards[m]);
        const right = rightGuess(r, s);
        const pays = right ? N / winCount(r, right)! : 0;
        let guess: string;
        if (right && (pays >= 1.5 || m === MAX_CARDS - 1)) guess = right;
        else if (m < MAX_CARDS - 1) guess = "skip";
        else guess = wrongGuess(r, s)!;
        view = await guessHilo(a, player, view.roundId, m, guess, newKey());
      }
      if (view.state === "cashed_out" && view.multiplier === MAX_MULTIPLIER) capped = view;
    }

    expect(capped).not.toBeNull();
    expect(capped!.payout).toBe(1_000_000 * COIN);
    expect(await openHiloRound(a, player)).toBeNull();
    const after = await settle(guessHilo(a, player, capped!.roundId, nextMove(capped!), "skip", newKey()));
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toMatch(/round_over/);
  });

  it("deals 64 cards at most: no skip on the last one, and the last guess ends the round", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    let round = await startHilo(a, player, bet, newKey());
    const cards = await peekCards(round.roundId);
    for (let m = 1; m <= MAX_CARDS - 2; m++) round = await guessHilo(a, player, round.roundId, m, "skip", newKey());
    expect(round.cards).toEqual(cards.slice(0, MAX_CARDS - 1));

    const last = MAX_CARDS - 1;
    const skip = await settle(guessHilo(a, player, round.roundId, last, "skip", newKey()));
    expect(skip.ok).toBe(false);
    if (!skip.ok) expect(skip.error).toMatch(/no_skips_left/);

    const r = rankOf(cards[last - 1]);
    const s = rankOf(cards[last]);
    const right = rightGuess(r, s);
    const ended = await guessHilo(a, player, round.roundId, last, right ?? wrongGuess(r, s)!, newKey());
    expect(ended.cards).toEqual(cards);
    if (right) {
      expect(ended.state).toBe("cashed_out");
      expect(ended.payout).toBe(payoutUnits(bet, [winCount(r, right)!]));
    } else {
      expect(ended.state).toBe("lost");
    }
    expect(await openHiloRound(a, player)).toBeNull();
  });
});

describe("cheat: cashing out twice", () => {
  it("returns the same payout and changes nothing when the cash-out is repeated later", async () => {
    const player = await newAccount(a);
    const round = await oneRightGuess(player);
    const key = newKey();

    const first = await cashOutHilo(a, player, round.roundId, key);
    const after = await balance(a, player);
    const second = await cashOutHilo(b, player, round.roundId, key);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.payout).toBe(first.payout);
    expect(await balance(a, player)).toBe(after);
    expect((await ledgerRows(a, player)).filter((l) => l.kind === "payout")).toHaveLength(1);
  });

  it("pays once when ten different cash-outs arrive at the same moment", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    const round = await oneRightGuess(player, bet);
    const clients = await Promise.all(Array.from({ length: 10 }, connect));

    try {
      const results = await Promise.all(clients.map((c) => settle(cashOutHilo(c, player, round.roundId, newKey()))));
      const ok = results.flatMap((r) => (r.ok ? [r.value] : []));
      const refused = results.flatMap((r) => (r.ok ? [] : [r.error]));

      expect(ok).toHaveLength(1);
      for (const error of refused) expect(error).toMatch(/round_over/);
      expect(ok[0].payout).toBe(payoutUnits(bet, countsOf(round)));
      expect(await balance(a, player)).toBe(WELCOME - bet + ok[0].payout);
      expect((await ledgerRows(a, player)).filter((l) => l.kind === "payout")).toHaveLength(1);
      expect(await endingRows(round.roundId)).toBe(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("pays once when the same cash-out arrives ten times at the same moment", async () => {
    const player = await newAccount(a);
    const bet = 10 * COIN;
    const round = await oneRightGuess(player, bet);
    const key = newKey();
    const clients = await Promise.all(Array.from({ length: 10 }, connect));

    try {
      const results = await Promise.all(clients.map((c) => cashOutHilo(c, player, round.roundId, key)));
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      for (const r of results) expect(r.payout).toBe(results[0].payout);
      expect(await balance(a, player)).toBe(WELCOME - bet + results[0].payout);
      expect((await ledgerRows(a, player)).filter((l) => l.kind === "payout")).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("settles a cash-out racing a guess exactly once, whichever lands first", async () => {
    for (let i = 0; i < 5; i++) {
      const player = await newAccount(a);
      const bet = 10 * COIN;
      const round = await oneRightGuess(player, bet);
      const cards = await peekCards(round.roundId);
      const m = nextMove(round);
      const r = rankOf(cards[m - 1]);
      const guess = r === 0 ? "lower" : "higher";

      const [guessed, cashed] = await Promise.all([
        settle(guessHilo(a, player, round.roundId, m, guess, newKey())),
        settle(cashOutHilo(b, player, round.roundId, newKey())),
      ]);

      expect(guessed.ok || cashed.ok).toBe(true);
      if (!guessed.ok) expect(guessed.error).toMatch(/round_over/);
      if (!cashed.ok) expect(cashed.error).toMatch(/round_over/);

      const { rows } = await a.query("select payout::bigint as payout from public.hilo_endings where round_id = $1", [
        round.roundId,
      ]);
      if ((await openHiloRound(a, player)) === null) {
        expect(rows).toHaveLength(1);
        const paid = Number(rows[0].payout);
        if (cashed.ok) expect(cashed.value.payout).toBe(paid);
        expect(await balance(a, player)).toBe(WELCOME - bet + paid);
        expect((await ledgerRows(a, player)).filter((l) => l.kind === "payout")).toHaveLength(paid > 0 ? 1 : 0);
      } else {
        // The guess landed first and was right; the cash-out was refused.
        expect(rows).toHaveLength(0);
        expect(await balance(a, player)).toBe(WELCOME - bet);
      }
    }
  });

  it("can't be given a second ending, even by writing to the table directly", async () => {
    const player = await newAccount(a);
    const round = await oneRightGuess(player);
    await cashOutHilo(a, player, round.roundId, newKey());

    const result = await settle(
      a.query(
        "insert into public.hilo_endings (round_id, state, payout, idempotency_key) values ($1, 'lost', 0, $2)",
        [round.roundId, newKey()],
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate key/);
    expect(await endingRows(round.roundId)).toBe(1);
  });
});

describe("cheat: the same hilo request sent twice", () => {
  it("returns the first round and changes nothing when a start is repeated later", async () => {
    const player = await newAccount(a);
    const key = newKey();

    const first = await startHilo(a, player, 10 * COIN, key);
    const spinAfter = (await seedStatus(a, player)).nextSpin;
    const second = await startHilo(b, player, 10 * COIN, key);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.roundId).toBe(first.roundId);
    expect(second.cards).toEqual(first.cards);
    expect(await balance(a, player)).toBe(WELCOME - 10 * COIN);
    expect((await seedStatus(a, player)).nextSpin).toBe(spinAfter);
    expect(await hiloRoundRows(player)).toBe(1);
  });

  it("starts once when the repeat arrives mid-flight", async () => {
    const player = await newAccount(a);
    const key = newKey();

    await a.query("begin");
    let first: HiloRound;
    try {
      first = await startHilo(a, player, 10 * COIN, key);
    } catch (error) {
      await a.query("rollback");
      throw error;
    }
    const repeat = settle(startHilo(b, player, 10 * COIN, key));
    await sleep(300);
    await a.query("commit");

    const second = await repeat;
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.replayed).toBe(true);
      expect(second.value.roundId).toBe(first.roundId);
    }
    expect(await hiloRoundRows(player)).toBe(1);
    expect(await balance(a, player)).toBe(WELCOME - 10 * COIN);
  });

  it("refuses a repeated start key with a different amount, or one used by another bet", async () => {
    const player = await newAccount(a);
    const key = newKey();
    const round = await startHilo(a, player, 10 * COIN, key);
    await play(a, player, round, "wrong");

    const different = await settle(startHilo(a, player, 20 * COIN, key));
    expect(different.ok).toBe(false);
    if (!different.ok) expect(different.error).toMatch(/idempotency_key_reused/);

    const other = newKey();
    await placeBet(a, player, COIN, other);
    const borrowed = await settle(startHilo(a, player, COIN, other));
    expect(borrowed.ok).toBe(false);
    if (!borrowed.ok) expect(borrowed.error).toMatch(/idempotency_key_reused/);
    expect(await hiloRoundRows(player)).toBe(1);
  });

  it("returns the same move and changes nothing when a guess is repeated later", async () => {
    const player = await newAccount(a);
    const round = await startHilo(a, player, COIN, newKey());
    const key = newKey();

    const first = await guessHilo(a, player, round.roundId, 1, "skip", key);
    const second = await guessHilo(b, player, round.roundId, 1, "skip", key);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.cards).toEqual(first.cards);
    expect(await moveRows(round.roundId)).toBe(1);
  });

  it("refuses a repeated move key with a different guess, or on another round", async () => {
    const player = await newAccount(a);
    const round = await startHilo(a, player, COIN, newKey());
    const key = newKey();
    await guessHilo(a, player, round.roundId, 1, "skip", key);

    const different = await settle(guessHilo(a, player, round.roundId, 1, "higher", key));
    expect(different.ok).toBe(false);
    if (!different.ok) expect(different.error).toMatch(/idempotency_key_reused/);

    const view = await openHiloRound(a, player);
    await play(a, player, view!, "wrong");
    const next = await startHilo(a, player, COIN, newKey());
    const elsewhere = await settle(guessHilo(a, player, next.roundId, 1, "skip", key));
    expect(elsewhere.ok).toBe(false);
    if (!elsewhere.ok) expect(elsewhere.error).toMatch(/idempotency_key_reused/);
    expect(await moveRows(next.roundId)).toBe(0);
  });

  it("makes one move when a guess is double-clicked", async () => {
    for (let i = 0; i < 5; i++) {
      const player = await newAccount(a);
      const round = await oneRightGuess(player);
      const m = nextMove(round);
      const guess = rankOf(round.cards.at(-1)!) === 0 ? "lower" : "higher";

      const results = await Promise.all([
        settle(guessHilo(a, player, round.roundId, m, guess, newKey())),
        settle(guessHilo(b, player, round.roundId, m, guess, newKey())),
      ]);
      const ok = results.filter((result) => result.ok);
      expect(ok).toHaveLength(1);
      for (const result of results) if (!result.ok) expect(result.error).toMatch(/stale_move|round_over/);
      expect(await moveRows(round.roundId)).toBe(m);
    }
  });
});

describe("cheat: bad hilo requests", () => {
  // What each refusal must leave untouched.
  async function snapshot(player: string, roundId?: number) {
    return {
      balance: await balance(a, player),
      lines: (await ledgerRows(a, player)).length,
      spin: (await seedStatus(a, player)).nextSpin,
      rounds: await hiloRoundRows(player),
      moves: roundId === undefined ? 0 : await moveRows(roundId),
      endings: roundId === undefined ? 0 : await endingRows(roundId),
    };
  }

  async function expectRefused(promise: Promise<unknown>, error: RegExp) {
    const result = await settle(promise);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  }

  for (const [what, amount, error] of [
    ["more than the balance", WELCOME + 1, /insufficient_balance/],
    ["zero coins", 0, /invalid_amount/],
    ["negative coins", -10 * COIN, /invalid_amount/],
  ] as const) {
    it(`refuses a start with ${what} and changes nothing, not even the spin number`, async () => {
      const player = await newAccount(a);
      const before = await snapshot(player);
      await expectRefused(startHilo(a, player, amount, newKey()), error);
      expect(await snapshot(player)).toEqual(before);
    });
  }

  it("refuses a second round while one is open", async () => {
    const player = await newAccount(a);
    const round = await startHilo(a, player, 10 * COIN, newKey());
    const before = await snapshot(player, round.roundId);
    await expectRefused(startHilo(a, player, 10 * COIN, newKey()), /hilo_round_open/);
    expect(await snapshot(player, round.roundId)).toEqual(before);
  });

  it("refuses a guess that isn't higher, lower or skip", async () => {
    const player = await newAccount(a);
    const round = await startHilo(a, player, COIN, newKey());
    const before = await snapshot(player, round.roundId);
    for (const guess of ["sideways", "", "HIGHER"]) {
      await expectRefused(guessHilo(a, player, round.roundId, 1, guess, newKey()), /invalid_guess/);
    }
    expect(await snapshot(player, round.roundId)).toEqual(before);
  });

  it("refuses a guess that can't lose: higher on an Ace, lower on a King", async () => {
    const player = await newAccount(a);
    let round = await startHilo(a, player, COIN, newKey());
    // Skip until an Ace or a King turns up (2 cards in 13).
    while (![0, 12].includes(rankOf(round.cards.at(-1)!))) {
      round = await guessHilo(a, player, round.roundId, nextMove(round), "skip", newKey());
    }
    const guess = rankOf(round.cards.at(-1)!) === 0 ? "higher" : "lower";
    const before = await snapshot(player, round.roundId);
    await expectRefused(guessHilo(a, player, round.roundId, nextMove(round), guess, newKey()), /guess_cannot_lose/);
    expect(await snapshot(player, round.roundId)).toEqual(before);
  });

  it("refuses a move number that isn't the next one", async () => {
    const player = await newAccount(a);
    let round = await startHilo(a, player, COIN, newKey());
    round = await guessHilo(a, player, round.roundId, 1, "skip", newKey());
    const before = await snapshot(player, round.roundId);
    for (const move of [0, 1, 3, -1, 64]) {
      await expectRefused(guessHilo(a, player, round.roundId, move, "skip", newKey()), /stale_move/);
    }
    expect(await snapshot(player, round.roundId)).toEqual(before);
  });

  it("refuses moves and cash-outs on someone else's round, or one that doesn't exist", async () => {
    const owner = await newAccount(a);
    const thief = await newAccount(a);
    const round = await oneRightGuess(owner);
    const before = await snapshot(owner, round.roundId);
    const thiefBefore = await snapshot(thief);

    await expectRefused(guessHilo(a, thief, round.roundId, nextMove(round), "skip", newKey()), /no_such_round/);
    await expectRefused(cashOutHilo(a, thief, round.roundId, newKey()), /no_such_round/);
    await expectRefused(guessHilo(a, owner, 999_999_999, 1, "skip", newKey()), /no_such_round/);
    await expectRefused(cashOutHilo(a, owner, 999_999_999, newKey()), /no_such_round/);

    expect(await snapshot(owner, round.roundId)).toEqual(before);
    expect(await snapshot(thief)).toEqual(thiefBefore);
  });

  it("refuses a cash-out before any right guess, even after skips", async () => {
    const player = await newAccount(a);
    let round = await startHilo(a, player, COIN, newKey());
    await expectRefused(cashOutHilo(a, player, round.roundId, newKey()), /no_right_guess/);
    round = await guessHilo(a, player, round.roundId, 1, "skip", newKey());
    const before = await snapshot(player, round.roundId);
    await expectRefused(cashOutHilo(a, player, round.roundId, newKey()), /no_right_guess/);
    expect(await snapshot(player, round.roundId)).toEqual(before);
  });

  it("refuses every move and cash-out once a round is lost or cashed out", async () => {
    const player = await newAccount(a);
    const lost = await play(a, player, await startHilo(a, player, COIN, newKey()), "wrong");
    const cashed = await cashOutHilo(a, player, (await oneRightGuess(player)).roundId, newKey());

    for (const round of [lost, cashed]) {
      const before = await snapshot(player, round.roundId);
      await expectRefused(guessHilo(a, player, round.roundId, nextMove(round), "skip", newKey()), /round_over/);
      await expectRefused(guessHilo(a, player, round.roundId, nextMove(round), "higher", newKey()), /round_over/);
      await expectRefused(cashOutHilo(a, player, round.roundId, newKey()), /round_over/);
      expect(await snapshot(player, round.roundId)).toEqual(before);
    }
  });

  it("lets you bet your whole balance, then nothing more after a loss", async () => {
    const player = await newAccount(a);
    const round = await startHilo(a, player, WELCOME, newKey());
    expect(round.balance).toBe(0);
    await play(a, player, round, "wrong");
    await expectRefused(startHilo(a, player, 1, newKey()), /insufficient_balance/);
  });
});

describe("cheat: hilo starts fired at the same moment", () => {
  it("opens one round, takes one bet", async () => {
    const player = await newAccount(a);
    const clients = await Promise.all(Array.from({ length: 20 }, connect));

    try {
      const results = await Promise.all(clients.map((c) => settle(startHilo(c, player, 10 * COIN, newKey()))));
      const ok = results.flatMap((r) => (r.ok ? [r.value] : []));
      const refused = results.flatMap((r) => (r.ok ? [] : [r.error]));

      expect(ok).toHaveLength(1);
      for (const error of refused) expect(error).toMatch(/hilo_round_open/);
      expect(await hiloRoundRows(player)).toBe(1);
      expect(await balance(a, player)).toBe(WELCOME - 10 * COIN);
      expect((await ledgerRows(a, player)).filter((l) => l.kind === "bet")).toHaveLength(1);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("cheat: changing the secret mid-round", () => {
  it("refuses to reveal the secret while a round is open, then allows it once the round ends", async () => {
    const player = await newAccount(a);
    const round = await oneRightGuess(player);
    const before = await seedStatus(a, player);

    for (const word of [null, "new word"]) {
      const result = await settle(rotateSeed(a, player, word));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/hilo_round_open/);
    }
    expect(await seedStatus(a, player)).toEqual(before);

    // The round carries on from the same secret.
    const cards = await peekCards(round.roundId);
    const skipped = await guessHilo(a, player, round.roundId, nextMove(round), "skip", newKey());
    expect(skipped.cards).toEqual(cards.slice(0, skipped.cards.length));

    await cashOutHilo(a, player, round.roundId, newKey());
    const { revealed } = await rotateSeed(a, player, "after");
    expect(revealed.fingerprint).toBe(before.fingerprint);
  });
});

describe("cheat: hilo rows", () => {
  it("can't be edited or deleted", async () => {
    const player = await newAccount(a);
    const round = await oneRightGuess(player);
    await cashOutHilo(a, player, round.roundId, newKey());

    for (const [table, edit] of [
      ["hilo_rounds", "set amount = 1"],
      ["hilo_moves", "set card = 51"],
      ["hilo_endings", "set payout = 999999999"],
    ] as const) {
      const where = table === "hilo_rounds" ? "id = $1" : "round_id = $1";
      const changed = await settle(a.query(`update public.${table} ${edit} where ${where}`, [round.roundId]));
      const removed = await settle(a.query(`delete from public.${table} where ${where}`, [round.roundId]));
      for (const result of [changed, removed]) {
        expect(result.ok, table).toBe(false);
        if (!result.ok) expect(result.error).toMatch(new RegExp(`${table}_are_append_only`));
      }
    }
  });

  it("can't share a spin with a dice round", async () => {
    const player = await newAccount(a);
    const dice = await playDice(a, player, COIN, 5000, "under", newKey());
    const round = await startHilo(a, player, COIN, newKey());
    expect(round.spin).toBe(dice.spin + 1);
  });
});

describe("cheat: the next card never reaches the browser", () => {
  it("hands back only cards already played, and nothing else", async () => {
    const player = await newAccount(a);
    const views: Array<Record<string, unknown>> = [];

    const start = await a.query("select * from public.start_hilo($1, $2, $3)", [player, COIN, newKey()]);
    views.push(start.rows[0]);
    const roundId = Number(start.rows[0].round_id);
    const cards = await peekCards(roundId);

    for (let m = 1; m <= 3; m++) {
      const { rows } = await a.query("select * from public.guess_hilo($1, $2, $3, 'skip', $4)", [
        player,
        roundId,
        m,
        newKey(),
      ]);
      views.push(rows[0]);
    }
    const open = await a.query("select * from public.open_hilo_round($1)", [player]);
    views.push(open.rows[0]);

    for (const view of views) {
      expect(Object.keys(view)).toEqual(HILO_COLUMNS);
      const shown = view.cards as number[];
      expect(shown).toEqual(cards.slice(0, (view.guesses as string[]).length + 1));
    }
  });
});

describe("cheat: the browser reaching hilo directly", () => {
  for (const role of ["anon", "authenticated"] as const) {
    for (const table of ["hilo_rounds", "hilo_moves", "hilo_endings"]) {
      it(`${role} cannot read ${table}`, async () => {
        const result = await as(role, `select * from public.${table}`);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/permission denied/);
      });
    }

    for (const [name, sql] of [
      ["start_hilo", "select * from public.start_hilo($1, 100, $2)"],
      ["guess_hilo", "select * from public.guess_hilo($1, 1, 1, 'skip', $2)"],
      ["cash_out_hilo", "select * from public.cash_out_hilo($1, 1, $2)"],
    ]) {
      it(`${role} cannot call ${name}`, async () => {
        const player = await newAccount(a);
        const result = await as(role, sql, [player, newKey()]);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(/permission denied/);
      });
    }

    it(`${role} cannot call open_hilo_round`, async () => {
      const player = await newAccount(a);
      const result = await as(role, "select * from public.open_hilo_round($1)", [player]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/permission denied/);
    });
  }
});
