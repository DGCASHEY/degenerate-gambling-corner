# Roadmap — Degenerate Gambling Corner

Claude: read this at the start of every session. Update it at the end of every
session. It is the memory between conversations.

**Status line — update this every time:**

    LAST SESSION: Session 03 done — design tokens (light + dark), type and
                  spacing scales, component gallery at /design.
    NEXT UP:      Build session 04 — accounts, wallet, append-only ledger.
                  Four cheating tests written and shown failing first.
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
- [x] 03 Buy ashey.bet (and degencorner.com as the backup)
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
- [ ] 04 Accounts, wallet, append-only ledger
      MUST: four cheating tests written and shown failing before any fix
      (duplicate bet, oversized bet, simultaneous requests, negative balance)
- [ ] 05 Fairness engine and the public verifier page
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
- [ ] Incognito settings page (three switches)
- [ ] Experience points, ranks, badges, daily bonus, leaderboard
- [ ] Slot engine: reels, paylines, payout tuning, free spins
- [ ] Slot artwork: three themes
- [ ] Texas Hold'em: hand evaluator, tables, blinds, timers, side pots
- [ ] Mobile layout, sound toggle, speed pass
- [ ] A page per game so search engines can find them
- [ ] Sentry and PostHog switched on
- [ ] Load rehearsal: a thousand simulated players at once
- [ ] Terms, privacy notice, responsible-play page, 18+ gate

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
