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
- The faucet - the free coin tap: a one-time 5,000 welcome grant, 200
  every hour, 1,000 every 24 hours. Coins are created only by the faucet
  and by game payouts, and payouts are play coins, never prizes.
- Incognito - three separate per-user switches: show in feed, show on
  leaderboard, public profile.

## Where things live

- src/app - Next.js App Router. Pages and layout live here. The holding
  page is src/app/page.tsx.
- tests/ - Vitest tests, run with npm test.
- tests/cheat/ - the exploit tests, run separately with npm run cheat.
  Everything that touches coins, outcomes or fairness gets a test here
  before it ships.
- supabase/migrations/ - the database: accounts, the ledger and every
  coin function. All coin rules are enforced here, not in page code.
- src/lib/wallet.ts - the website's only way into the wallet.
- tests/db/ - starts a throwaway real Postgres for the tests.
- public/mascot/ - character art. character-sheet.png is the raccoon
  mascot reference sheet.
- .github/workflows/ci.yml - runs lint, test, cheat and build on every
  push and pull request to main.
- Live site: dgcbet.net, deployed on Vercel from this repo's main branch.

## Commands

- npm run dev   - start the site locally
- npm test      - run the test suite
- npm run cheat - the exploit tests. These pass before anything is committed.
- npm run lint  - check code style. CI runs this too.

## Elsewhere

- Player-facing writing follows VOICE.md.
- Never read, edit or print the contents of .env.local.
