# Roadmap — Degenerate Gambling Corner

Claude: read this at the start of every session. Update it at the end of every
session. It is the memory between conversations.

**Status line — update this every time:**

    LAST SESSION: 05 — provably fair seeds (sealed secret, client word,
                  spin counter), public verifier at /fairness, Fairness
                  card on /account. Migration applied to Supabase.
    NEXT UP:      Build session 06 — shared bet panel and Dice. Dice
                  gets its outcome from public.take_spin inside the same
                  transaction as the bet, and adds a "Dice roll" line to
                  the verifier.
    BLOCKED ON:   nothing

---

## How to use this file

1. At the start of a session, read this file and tell Asher where we are.
2. Do exactly one session from the list below. Not two.
3. At the end: tick the box, add a note at the bottom, update the status line
   above, and commit.

Marks: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Day one — setup

- [x] 01 Claude account and plan
- [x] 02 GitHub account and empty private repository
- [x] 03 Buy the domain (live site is dgcbet.net)
- [x] 04 Supabase account and empty project
- [x] 05 Vercel account, linked to GitHub
- [x] 06 Upstash, Resend, Sentry, PostHog accounts
- [x] 07 Install Node, Git, GitHub tool
- [x] 08 Connect services to Claude
- [x] 09 Project folder created and opened in Claude
- [x] 10 .env.local created, keys pasted in, .gitignore excludes it
- [x] 11 CLAUDE.md written
- [x] 12 Project scaffolded, deployed, dgcbet.net shows a holding page
- [x] 13 Mascot character sheet generated

## Build sessions

Model: **Sonnet** for all of these — Asher is on the Pro plan.
One session per sitting. Fresh conversation each time. Commit at the end.

- [x] 02 VOICE.md written, CLAUDE.md refreshed against the real project
- [x] 03 Design system: colour tokens, type scale, light and dark, component gallery
- [x] 04 Accounts, wallet, append-only ledger
      MUST: four cheating tests written and shown failing before any fix
      (duplicate bet, oversized bet, simultaneous requests, negative balance)
- [x] 05 Fairness engine and the public verifier page
- [ ] 06 Shared bet panel (manual and auto) and Dice
      MUST: one million simulated rounds match the predicted win rate
- [ ] 07 Limbo, Wheel, Keno
- [ ] 08 Capture the pattern as /newgame, then prove it with `/newgame Hilo`
- [ ] 09 Mines — server-held board, double-cash-out test written first
- [ ] 10 Plinko — server decides the slot, the animation follows it
- [ ] 11 Crash — referee programme, shared clock, cash-out ordering

## After the games

- [ ] Live bet feed, player counters, public profiles
- [ ] Chat: filter, speed limit, kill switch
- [~] Incognito settings page (three switches) — switches stored and
      editable on /account since session 04; nothing reads them yet
      (feed and leaderboard don't exist)
- [ ] Experience points, ranks, badges, daily bonus, leaderboard
- [ ] Slot engine: reels, paylines, payout tuning, free spins
- [ ] Slot artwork: three themes
- [ ] Texas Hold'em: hand evaluator, tables, blinds, timers, side pots
- [ ] Mobile layout, sound toggle, speed pass
- [ ] A page per game so search engines can find them
- [ ] Sentry and PostHog switched on
- [ ] Load rehearsal: a thousand simulated players at once
- [ ] Terms, privacy notice, responsible-play page, 18+ gate
      (sign-up already requires an 18+ tick-box, enforced by the database)

## Loose ends

Small jobs that don't belong to a session. Pick off when there's a gap.

- [ ] Supabase email through Resend (custom SMTP) before real players
      arrive. Built-in email works but only sends about 2 an hour.
      Asher enters the Resend key in Supabase (Claude can't handle keys).
- [x] Homepage has no sign-in or sign-up link yet. Players must type
      /signup or /login. (Fixed by the homepage, 2026-09-27.)
- [ ] Sign in on dgcbet.net and check the homepage top bar shows your
      username and balance. Covered by a test, not yet seen on screen.
- [ ] GitHub lets admins push to main without the checks passing (seen
      on the session 03 push, and again on the homepage push). Tick "include administrators" in branch
      protection, or switch to pull requests per session.
- [ ] Re-authorise the Claude connection to Vercel for this team, so
      Claude can read runtime logs and settings (currently 403).
- [ ] Review the broad "Claude" OAuth connection in PostHog (147+ write
      scopes, noted 2026-09-13).
- [ ] Supabase security check says "Leaked password protection" is off
      (Authentication settings). Switching it on refuses passwords known
      from data leaks. Asher's call; noted 2026-09-28.

---

## Rules that never bend

Also in CLAUDE.md. Repeated here because they matter most.

- No real money in or out. Ever. No purchases, prizes, redemption, or coin
  transfers between players.
- Every outcome is decided on the server. The browser only animates.
- Balances are derived from the ledger, never stored as an editable number.
- Failing test first on anything touching coins, outcomes or fairness.
- Ask before adding a dependency, or inventing a second way to do something
  that already has a pattern here.

---

## Session notes

Newest at the top. One or two lines each: what got done, what broke, what to
watch next time.

    2026-09-28 — Small fix before session 06, at Asher's request: a
    "Home" button on /account (top row, next to Sign out), using the
    existing ButtonLink. Lint and 115 tests pass. Not yet seen on screen
    signed in (Claude can't type the password); check it live.

    2026-09-28 — Session 05 done. Provably fair, all in
    supabase/migrations/20260927140000_fairness.sql (applied to Supabase):
    seed_pairs table, each pair waiting -> live -> revealed. Secret = 32
    random bytes as 64 hex chars; fingerprint = SHA-256 of that text;
    numbers = HMAC-SHA256(secret, "word:spin:round"), 4 bytes each / 2^32.
    A CHECK makes the fingerprint always match its secret; a trigger
    seals everything else (counter only up, revealed pairs frozen); the
    server can't delete; the browser can reach nothing. Games call
    take_spin(account, count) inside the bet transaction: it returns
    the spin number and numbers, never the secret. Same recipe in
    src/lib/fairness.ts (Web Crypto, no new package) for the public
    verifier at /fairness; src/lib/seeds.ts is the site's only way in.
    Found and fixed a hole in my own first plan: the new secret was made
    at the moment the player chose their word, so a crooked server could
    reroll it. Now a NEXT secret is always sealed in advance and its
    fingerprint shown on /account before the word is picked (tests first).
    Tests: 28 new cheat tests, all shown failing first, incl. Asher's two
    (same inputs = same answer across DB, browser and Node's crypto;
    revealed secret matches the fingerprint shown earlier). One passed
    before anything existed (table missing), so every refusal test now
    demands its exact error. The emoji client word exposed that the test
    database was WIN1252 on Windows; tests/db/global-setup.ts now forces
    UTF-8 like Supabase. 115 tests, 64 cheat, lint, build all pass.
    Proven: known-answer numbers match in Supabase; verifier page shows
    them and says "Does not match" for a one-character change; no
    sideways scroll on a phone. Asher rotated twice on localhost/account
    and "Check it" said Matches.
    Watch in session 09 (Mines): a game stays open across clicks, so
    rotating mid-game would reveal the secret and the mine positions.
    Refuse rotation while a Mines game is open. Also: the verifier shows
    raw numbers only; each game session adds its own result line.
    The desktop app's browser pane can be hidden; if Asher can't find it,
    use http://localhost:3000 in a normal browser instead.

    2026-09-27 — Homepage, done between sessions 04 and 05 at Asher's
    request. Top bar: Sign in / Create account when signed out; username
    + ledger balance (read only) when signed in. Hero line in VOICE.md
    style with the smug raccoon, cropped from the character sheet into
    public/mascot/smug.png (Windows' built-in System.Drawing, no new
    package). Games grid comes from ONE list, src/lib/games.ts: when a
    game ships, give it an href there and its card becomes a link. Also
    "What works right now" cards (faucet, ledger, incognito, fairness —
    update the fairness card after session 05). Page is split into
    page.tsx (loads the player) and home-view.tsx (draws it). If the
    Supabase lookup fails, the homepage falls back to signed-out instead
    of a 500 (tested). Added ButtonLink to button.tsx: a link styled
    exactly like Button. Checked at phone width: no sideways scroll,
    site name shortens to "DGC". Watch: only one `next dev` can run per
    folder, so a second chat can't start its own preview; view the
    existing one on :3000 instead. Follow-up the same day: badges no
    longer wrap (badge.tsx: whitespace-nowrap), pushed and live.
    Both pushes: lint, 82 tests, 36 cheat tests and build passed locally
    and in CI; live dgcbet.net checked signed out (hero, mascot, nine
    "Not built yet" cards). Signed-in top bar not yet seen live — in
    Loose ends. Next: session 05, then point the Fairness card at the
    verifier.

    2026-09-27/28 — Session 04 done and live on dgcbet.net. Asher chose to do
    sign-in in the same session (flagged as two concerns, overridden).
    Decisions: new accounts get 5,000 (a one-time "welcome" faucet entry);
    two separate taps, hourly 200 and daily 1,000, claimable at any
    balance; email + password sign-in with a required 18+ tick-box;
    privacy defaults feed on / leaderboard on / profile off; coins stored
    as whole hundredths. CLAUDE.md faucet wording changed: coins now come
    from the faucet AND game payouts (Asher's call, payouts are play coins).
    All coin rules live in supabase/migrations/20260927120000_wallet.sql:
    row lock per player, idempotency key per movement, append-only
    triggers, a never-negative trigger that also locks, fixed faucet
    amounts as a CHECK, browser roles revoked. Tests run against a real
    throwaway Postgres 17 (embedded-postgres, no Docker). Shown failing
    first against a deliberately unprotected draft: all 31 attacks
    succeeded (20 simultaneous bets on a 5,000 balance all went through,
    a -1,000 bet printed coins). Then 36/36 pass, five runs in a row.
    Migration applied to Supabase (project was paused, woken with Asher's
    OK); Supabase security check only notes "RLS on, no policies", which
    is deliberate. New packages: @supabase/supabase-js, @supabase/ssr,
    pg, @types/pg, embedded-postgres (pinned 17.10.0-beta.17; "beta" is
    the package's label, Postgres itself is stable).
    Proven locally: Asher signed up as "deboss", confirmation email
    arrived (it was in a different inbox than expected, so I marked the
    account confirmed by hand in Supabase before we realised), signed in,
    claimed both taps. Ledger: welcome +5,000, hourly +200, daily +1,000,
    balance 6,200. Exactly one line per claim.
    Outage on first push: every live page returned 500, most likely the
    Supabase settings not reaching the Vercel build (src/proxy.ts threw on
    every request). Fixed so a missing setting only breaks sign-in:
    the proxy now skips the login refresh and logs an error instead
    (src/proxy.test.ts). Then fixed the Vercel variables one at a time,
    using Vercel's runtime Logs to see which was missing: first the URL,
    then the anon key (Supabase's newer screens call it "publishable"),
    then the service role key ("secret"). Each fix needed a redeploy.
    Finished 2026-09-28 00:04 UTC: Asher signed in on dgcbet.net and the
    account page's database requests were all accepted. Supabase redirect
    URLs for dgcbet.net and localhost are set.
    Lesson for next time: when a live page 500s, read Vercel's runtime
    Logs (project top menu > Logs) first. The Claude connection to Vercel
    can't see this team, so Asher reads them.
    Watch: embedded-postgres's install script is skipped by npm, but CI
    passes on Linux anyway, so it isn't needed. Open follow-ups are in
    "Loose ends" above.

    2026-09-27 — Session 03 done. All colours are tokens in
    src/app/globals.css (navy bg, one electric-blue accent, win/loss/warn
    for results only), light + dark, contrast-checked (text 4.5:1+, input
    borders 3:1+). Tailwind's own palette and text sizes are switched off,
    so bg-black / text-blue-500 do nothing; tests/design-tokens.test.ts
    fails if a raw colour sneaks into src/. Type scale xs-4xl (12-56px),
    Geist + Geist Mono for numbers, 4px spacing grid plus named gutter /
    card / section gaps. Components in src/components/ui/: button, input
    (Field, Input, Switch, SegmentedControl), card, badge, table, feed row,
    bet panel shell (Manual/Auto, layout only, buttons wired to nothing).
    Gallery at /design (noindex) with a Light/Dark/System preview switch.
    Holding page moved onto tokens, so it is navy now, not black. Added
    .claude/launch.json so the dev server can be previewed. No game logic,
    no new dependencies. Watch: pass extra display classes on a wrapper,
    not on Button itself; they can lose to its built-in inline-flex.

    2026-09-27 — Session 02 done. CLAUDE.md refreshed against the real
    project: added a "Where things live" section (src/app, tests/,
    tests/cheat/, public/mascot/, the CI workflow, the live dgcbet.net
    domain), added npm run lint to Commands, and removed the "Player-facing
    writing follows VOICE.md" line since VOICE.md didn't exist yet. Then
    Asher pasted VOICE.md verbatim (the honest-to-the-point-of-rudeness
    voice thesis, mascot tone, do/don't rules, sounds-right/sounds-wrong
    examples) and it was written exactly as given, no additions. Added the
    VOICE.md reference back to CLAUDE.md's Elsewhere section now that the
    file is real. Words we use and the never-broken rules were left alone —
    nothing there was stale.

    2026-09-27 — Step 13 done. Mascot: a scrappy anthropomorphic raccoon
    gambler in a rumpled navy velvet smoking jacket with electric-blue
    lapels, gold chain, cards + chips in hand — matches the dark
    navy/electric blue brand palette. Generated via Higgsfield
    (gpt_image_2_5), front/side/three-quarter turnaround +
    winning/losing/bored/smug expressions, single 2688x1520 sheet, not yet
    cropped into individual sprites — that's follow-up work whenever it's
    needed for real UI use. First pass had an AI hand glitch (a duplicate
    hand stacked at the wrist in the side and three-quarter poses, where
    the cards-hand and chips-hand overlapped) — Asher caught it, regenerated
    with explicit "no extra hands / no duplicate hands" in the prompt. That
    fixed the three-quarter pose but the side (middle) pose still had a
    third hand (a resting fist at the hip on top of the cards+chips hands)
    — Asher caught that too. Fixed for real with two nano_banana_2
    image-edit passes on that exact reference image: first removed the
    extra fist (which also dropped the chips), then added the chips back
    into that now-two-handed fist so it matches the front/three-quarter
    poses. Verified every pose and all four expressions by cropping and
    inspecting closely before saving over public/mascot/character-sheet.png.
    Worth remembering for any future multi-limb character art: check hands
    closely, more than once, before calling it done.

    2026-09-27 — Step 12 done. Scaffolded Next.js/TS/Tailwind (App Router),
    holding page live, Vitest wired up (npm test + placeholder npm run
    cheat), GitHub Actions CI added. Live domain is dgcbet.net, NOT
    ashey.bet as step 03 says — Asher confirmed dgcbet.net is the real one,
    roadmap text above is stale, worth fixing/clarifying later. Had to make
    the GitHub repo PUBLIC: branch protection needs GitHub Pro on a private
    repo, Asher chose public over paying or skipping the "can't merge
    broken code" rule — no secrets in the repo, those stay in gitignored
    .env.local. Vercel's GitHub App wasn't actually installed despite the
    step 05 checkbox (that was just "signed into Vercel with GitHub", not
    real repo access) — Asher connected it himself via vercel.com/new.
    Deployed and dgcbet.net confirmed serving HTTPS successfully.

    2026-09-13 — .env.local + .gitignore created, keys for Supabase,
    Upstash, Resend, Sentry, PostHog fetched (with Claude driving the
    browser for the lookups) and pasted in by Asher, then live-tested
    against each service — all 6 keys confirmed working. Note: created a
    new Sentry project (degenerate-gambling-corner, Next.js platform) and
    a new Resend API key + Sentry org auth token, since none existed yet.
    Also noticed a broad-scope "Claude" OAuth connection already
    authorized in PostHog (147+ write scopes) — left it alone, worth
    Asher reviewing later.
