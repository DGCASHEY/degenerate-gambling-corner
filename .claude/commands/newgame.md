---
description: Build a new instant-settle Original the same way as Dice, Limbo, Wheel and Keno
argument-hint: <GameName>
---

# /newgame $ARGUMENTS

Build **$ARGUMENTS** as a new Original, following the exact pattern Dice,
Limbo, Wheel and Keno share. This is the whole recipe. Do not invent a
second way to do anything below. If a step does not fit this game, stop and
ask Asher; do not improvise.

Everything in CLAUDE.md still applies: Asher is fourteen and not a
programmer, so explain each step in plain words before doing it and say
what a command will change before running it. Never read .env.local.

Throughout, `<game>` means the lowercase name (e.g. `hilo`) and `<Game>` the
capitalised one (e.g. `Hilo`).

## Step 0 — Read, then check the game fits

1. Read ROADMAP.md and tell Asher where things stand.
2. Read the reference game end to end before writing anything. Limbo is
   the simplest: `supabase/migrations/20260928130000_limbo.sql`,
   `src/lib/limbo.ts`, `playLimbo` in `src/lib/wallet.ts`,
   `src/app/limbo/` (actions.ts, page.tsx, limbo-game.tsx),
   `tests/cheat/limbo.test.ts`, `tests/cheat/limbo-odds.test.ts`,
   `playLimbo` in `tests/db/helpers.ts`. Also look at Wheel (a player
   choice plus an animation that waits for the result) and Keno (several
   fair numbers per spin, a list of picks) when the new game resembles them.
3. **The stays-open check. Do this before anything else is planned.**
   This pattern only covers games that settle in ONE request: the player
   bets, the server decides everything, pays, and the round is over.
   Ask: does $ARGUMENTS keep a round open between clicks? Signs that it
   does: the player makes more than one decision per bet (higher/lower,
   open another tile, hit/stand), there is a "cash out" button, the
   outcome depends on when the player acts, or several players share one
   round (Crash, poker).
   If ANY of those is true: **stop here.** Tell Asher, in plain words,
   that $ARGUMENTS stays open between clicks, that there is no pattern for
   that yet, and what the new problems are (at least: where the open
   round's hidden state lives, refusing to reveal the secret while a round
   is open, and a cash-out that must only ever pay once). Do not write a
   plan, tests or code for it. Ask Asher how he wants to proceed.
   If none are true, say so in one sentence and carry on.

## Step 1 — Asher's choices, then the plan (stop and wait)

Ask Asher for every choice the game needs, suggesting the house's usual
answers, then write back the plan and wait for his go:

- What the player sets (target, risk level, picks...) and the allowed range.
- How the spin's fair numbers become a result (how many numbers are needed
  from `take_spin`; each is k / 2^32 for a whole k).
- The pay table or payout formula. House edge 1% unless he says otherwise.
  Amounts are whole hundredths of a coin; payouts round DOWN.
- The theoretical return (RTP) for every setting, worked out exactly. This
  is what the million rounds will be checked against. Show it to him.
- Anything in the page he cares about (animation length, colours, keys).

## Step 2 — Tests first, shown failing (stop and show)

Write these before any real code, modelled line by line on Limbo's:

- `tests/cheat/<game>.test.ts`, with the same groups:
  - `<game>: the maths` — exact known answers; the browser copy and the
    database copy agree on results and on every payout.
  - `<game>: a round` — takes the bet, pays a win exactly, pays nothing on
    a loss; a new spin number every round, shared with the other games;
    the result can be rechecked from the revealed secret.
  - `cheat: the same <game> bet sent twice` — repeat later returns the
    first round and changes nothing; repeat mid-flight settles once;
    repeated key with different settings or amount is refused; a key used
    by another bet is refused.
  - `cheat: bad <game> bets` — every bad setting and amount refused with
    its EXACT error, changing nothing, not even the spin number; betting
    the whole balance works, then nothing more after a loss.
  - `cheat: <game> bets fired at the same moment` — never overspends,
    never reuses a spin number.
  - `cheat: <game> rounds` — can't be edited or deleted; can't share a
    spin with another game's round.
  - `cheat: the browser reaching <game> directly` — anon and
    authenticated can't read the rounds or call `play_<game>`.
- `tests/cheat/<game>-odds.test.ts`, modelled on `limbo-odds.test.ts`:
  - One million rounds drawn in SQL with `fair_numbers` and the game's own
    database functions (exactly what `play_<game>` uses, minus the ledger
    writes), with a fresh random secret each run, printed.
  - Every outcome's frequency within 4.5 standard errors of the exact
    prediction (same `expectRate` helper and TOLERANCE as Limbo).
  - For every setting: actual paid-back % printed beside the theoretical
    RTP from Step 1.
  - 10,000 real auto bets through `play_<game>` using `startAuto` /
    `afterRound`, checking every coin against the ledger.
- A `play<Game>` helper in `tests/db/helpers.ts`, like `playLimbo`.
- A placeholder `src/lib/<game>.ts` whose functions throw, so every test
  fails on its own rather than passing because something is missing.

Explain `npm run cheat` (runs only the exploit tests; changes nothing),
run it, and show Asher the failures. Wait for him before fixing.

## Step 3 — Build, using only what already exists

Copy the reference game's shape exactly. The ledger, the fairness engine,
`place_bet`, `take_spin`, the `payout` ledger kind and the BetPanel are
USED, never changed.

1. **Migration** `supabase/migrations/<timestamp>_<game>.sql`, timestamp
   later than every existing file. Header comment listing the rules.
   Then, as in Limbo:
   - `<game>_check_...` (raises `invalid_<setting>`), `<game>_result`,
     `<game>_payout` — `immutable`, `set search_path = ''`, whole-number
     maths only.
   - `<game>_rounds`: bet_ledger_id unique, payout_ledger_id unique and
     null on a loss, `unique (seed_pair_id, spin)`, CHECKs on every column,
     the payout-line CHECK, an account index, and the append-only
     trigger on update, delete and truncate.
   - `play_<game>(p_account, p_amount, <settings>, p_key)`: check amount
     and settings; `place_bet`; if replayed, return the remembered round
     (or `idempotency_key_reused` if the settings differ); `take_spin`;
     result; payout ledger line keyed `'payout:' || v_bet.ledger_id`;
     insert the round; return it with `get_balance`. All one transaction.
   - Enable RLS; revoke everything from public, anon, authenticated;
     revoke update, delete, truncate on the rounds from service_role.
2. **`src/lib/<game>.ts`** — the same maths for display and the verifier,
   with the "This file never decides a result" header. BigInt where
   rounding could creep in.
3. **`play<Game>` in `src/lib/wallet.ts`** and its `<Game>Round` type,
   copying `playLimbo`.
4. **`src/app/<game>/actions.ts`** — `play<Game>Action`: signed-in check,
   shape check (safe integers, key 8–100 chars), error codes mapped to
   player messages written per VOICE.md.
5. **`src/app/<game>/page.tsx`** and **`<game>-game.tsx`** — the shared
   `BetPanel` with `controls` and `stage`, `crypto.randomUUID()` per bet,
   `profitOnWin` (or leave it out when a win can pay several amounts), the
   "This visit" table and the "Check any result" card. The page only shows
   what the server returned. Any animation plays a result already handed
   back and never changes it.
6. **Hook-ups:** a result card in `src/app/fairness/verifier.tsx`, an
   `href` for the game in `src/lib/games.ts`.

If any of this needs something that has no pattern here (a new ledger
kind, a change to BetPanel, a new package, a second way to draw
randomness): stop and ask Asher first. A needed BetPanel change gets its
own failing test in `src/components/ui/bet-panel.test.tsx` first.

## Step 4 — Prove it

Run, explaining each first: `npm run cheat`, `npm test`, `npm run lint`,
`npm run build`. All must pass. Then report the million-round result to
Asher as a small table, one row per setting:

| Setting | Theoretical RTP | Actual RTP | Standard errors | Pass? |

and say plainly whether the actual payout rate matches the theoretical
one. If any row is outside 4.5 standard errors, it is a bug: say so, do
not rerun hoping for a better draw, find the cause.

Check the page in the browser preview signed out, at phone width.

## Step 5 — Finish

1. The migration: auto mode blocks Claude from applying it to Supabase.
   Ask Asher to paste the file into Supabase's SQL Editor (or switch out
   of auto mode). Afterwards, check read-only that the functions and
   guards exist and the browser is locked out.
2. Ask Asher to play a few rounds signed in, then check the database
   read-only: every bet and payout line matches its round, no negative
   balances.
3. Update ROADMAP.md: tick the box, add a session note (Asher's choices,
   test counts, the RTP table, anything that changed from the plan and
   why), update the status line. Mention that CI time grows by this
   game's million-round test (see the loose end about it).
4. Commit with a message like `Session NN: <Game>`.
