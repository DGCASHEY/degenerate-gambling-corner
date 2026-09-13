# Degenerate Gambling Corner

A play-money social casino. Nothing in it is real money.

Asher is fourteen and not a programmer. Explain what you are about to do before
you do it, and say what a command will change before you run it.

Read ROADMAP.md at the start of every session. Update it at the end of every
session, before committing.

## Rules that are never broken

- No real money enters or leaves. No purchases, no prizes, no redemption,
  no coin transfers between players, nothing buyable at any price.
- Every game outcome is decided on the server. The browser animates a
  result it was handed. It never decides one.
- Coin balances are derived by summing an append-only ledger. Never store
  a balance as a single editable number.
- Every coin movement happens in one all-or-nothing database transaction
  and carries an idempotency key, so a repeated request is ignored rather
  than applied twice.
- No easter egg, animation or feature may ever change a bet result.
- The age gate says 18+. Never soften it.

## How to work with me

- Plan before building. For anything bigger than a small fix, tell me the
  approach and wait for me before writing code.
- Anything touching coins, outcomes or fairness: write the failing test
  first, show me it failing, then fix it.
- Ask before adding any dependency.
- Ask before inventing a second way to do something that already has a
  pattern here.
- One concern per session. If I have asked for two things, say so.

## Words we use

- Originals - the in-house instant-settle games: Dice, Limbo, Wheel, Keno,
  Mines, Plinko, Crash.
- The referee - an always-awake Cloudflare Durable Object owning a shared
  clock. One for Crash, one per poker table.
- The ledger - the append-only list of every coin movement. The truth.
- The faucet - the free coin tap. The only way a coin is ever created.
- Incognito - three separate per-user switches: show in feed, show on
  leaderboard, public profile.

## Commands

- npm run dev   - start the site locally
- npm test      - run the test suite
- npm run cheat - the exploit tests. These pass before anything is committed.

## Elsewhere

- Player-facing writing follows VOICE.md.
- Never read, edit or print the contents of .env.local.
