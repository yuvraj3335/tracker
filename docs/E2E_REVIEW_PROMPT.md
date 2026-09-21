# End-to-end review prompt

Paste the block below into a **new chat**. It is self-contained: it names the
repo, how to boot it, how to get a database, what can and cannot be exercised,
and what to produce.

It assumes **nobody is available to answer questions**. Every "ask the user"
branch has been replaced with "decide, write the assumption down, continue".

---

```
INDEPENDENT REVIEW
REPO (local):  /Users/yuvrajmuley/work/job-switch-tracker
REMOTE:        git@github.com:yuvraj3335/tracker.git
BRANCH:        main   (this project pushes straight to main — there is no PR)
BASE:          for a change-scoped review, diff against the previous commit.
               For a full review, treat the whole application as in scope.
UAT:           not deployed. Skip all live-environment testing and say so.
I AM OFFLINE:  do not wait for me. Never block on a question.

You are a staff+ engineer. Job: independently review this codebase, then
actually exercise every flow you can reach — locally. Produce a written report,
commit it, and push it. Do not change application code unless you are fixing a
defect you have proven, and if you do, the fix and the report go in separate
commits.

Use the strongest reasoning you have. Do not rush. Do not assume.

════════════════════════════════
RULE 0 — INDEPENDENT REVIEW
════════════════════════════════
This chat is a blank room. You are seeing this code for the first time.

Do NOT lean on: other chats or sessions, prior reviews of this repo, GitHub
threads, your beliefs about how Next.js/Notion/Postgres projects "usually"
work, or typical bugs in this stack used as a substitute for tracing THIS code.

Allowed inputs: this message, the repo on disk, files you personally open,
commands you personally run.

If you think "I already know how X works here" — you do not. Open the file. If
the file and your memory disagree, the file wins.

A green test suite, a confident README, and a tidy commit history are not
evidence the behavior is correct. The README in particular makes strong claims
("nothing is logged twice", "resumable", "456 not 474"). Treat every claim in
it as a hypothesis to verify against code, not as fact.

════════════════════════════════
BECAUSE I AM OFFLINE
════════════════════════════════
Replace every "stop and ask" with:
  1. Pick the most defensible option.
  2. Record it under "Assumptions I made" in the report.
  3. Continue.

Two hard exceptions — never do these without a human:
  - Anything that writes to a real Notion workspace you did not create.
  - Anything that touches a real deployment, real credentials, or `git push
    --force`.
Log those as `Not verified` with the blocker instead.

════════════════════════════════
PHASE 0 — ORIENT
════════════════════════════════
1. `cd /Users/yuvrajmuley/work/job-switch-tracker`, confirm branch and HEAD SHA,
   and confirm the tree is clean before you start. If it is dirty, stash and
   note it — do not review someone's half-finished edit as if it shipped.
2. Read for intent, in this order: `README.md`, then `git log` messages (they
   are unusually detailed in this repo and state what each change was meant to
   guarantee), then the code. Commit messages state intent; they are NOT proof
   the intent was achieved.
3. Do not read GitHub threads. There are none worth reading; this repo is
   pushed directly.

════════════════════════════════
WHAT THIS APP IS (orientation only — verify everything)
════════════════════════════════
A multi-tenant DSA tracker. Next.js 16 App Router, React 19, TypeScript,
Tailwind v4.

Two datastores, deliberately split:
  - Postgres  — user accounts + each user's ENCRYPTED Notion token. Nothing else.
  - Notion    — every question, completion and date, in the USER'S OWN workspace.

The whole product hangs on one input: ticking a question writes `Done` and
`Completed On` to Notion. The daily tracker, heatmap, streaks and overall
progress are all derived from that one date. Verify that claim.

Shape of the code:
  src/lib/       db, crypto, session, tenant, notion, provision, derive, date,
                 schema, themes, appearance, celebrate
  src/app/       routes (pages + API), server actions in actions.ts
  src/components/ UI
  scripts/       scrape-a2z.mjs (data provenance), selftest.ts (60 assertions)
  data/          a2z-seed.json — the scraped sheet, committed

════════════════════════════════
BOOT IT (exact, tested recipe)
════════════════════════════════
Node 25 / npm 11 are installed. `npm install` first.

You need a Postgres. There is no running one. Homebrew postgresql@16 is
installed but its service is broken — start a throwaway instance instead.
Both of these gotchas will bite you, so use these commands verbatim:

    export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
    export LANG=C LC_ALL=C          # initdb fails with "invalid locale" otherwise
    PGDIR=<your scratchpad>/pg
    mkdir -p "$PGDIR" /tmp/pgsock   # socket dir must be SHORT; a long scratchpad
                                    # path exceeds the 103-byte socket limit
    initdb -D "$PGDIR/data" -U postgres --auth=trust --locale=C
    pg_ctl -D "$PGDIR/data" \
      -o "-p 55432 -k /tmp/pgsock -c listen_addresses=127.0.0.1" \
      -l "$PGDIR/pg.log" start
    /opt/homebrew/opt/libpq/bin/psql -h 127.0.0.1 -p 55432 -U postgres \
      -c "create database tracker;"

`psql` resolves to `/opt/homebrew/opt/libpq/bin/psql` (libpq, client only —
it cannot start a server; `initdb`/`pg_ctl` come from the postgresql@16 path
exported above).

Then `.env.local` (it is gitignored; `.env.example` documents every key):

    npm run keygen        # prints SESSION_SECRET and ENCRYPTION_KEY
    DATABASE_URL=postgresql://postgres@127.0.0.1:55432/tracker
    APP_TIMEZONE=Asia/Kolkata

The DB driver switches on the URL: Neon's HTTP driver for `*.neon.tech`,
standard `pg` over TCP otherwise. Local Postgres exercises the `pg` branch, so
**the Neon branch will go untested** — say so in the report.

The schema creates itself on first signup (`ensureSchema`). No migration step.

Commands: `npm run dev` (port 3000), `build`, `typecheck`, `lint`,
`test` (60 assertions), `scrape` (re-scrapes and asserts integrity).

════════════════════════════════
WHAT YOU CAN AND CANNOT EXERCISE — READ THIS BEFORE PLANNING
════════════════════════════════
FULLY TESTABLE, no excuses:
  - signup / signin / signout, session cookies, the proxy gate
  - password hashing, token encryption, session signing  (`npm run test`)
  - validation, duplicate + case-insensitive usernames, user enumeration timing
  - open-redirect handling on `?next=`
  - every derived calculation: streaks, heatmap buckets, velocity, rollups
  - all timezone-sensitive day maths
  - the whole UI, via the dev-only harness at `/preview`
  - loading skeletons, error boundary, not-found
  - schema migration / upgrade path (build a DB from an older schema, run
    `ensureSchema`, assert the column appears — this has been done before)

NOT TESTABLE without a real Notion integration token:
  - creating databases in a workspace, seeding 456 questions, live reads/writes

Do NOT fake this by pointing at someone's real workspace. Two honest options:
  a) Stub `globalThis.fetch` and drive `seedChunk` / provisioning directly.
     `scripts/selftest.ts` already does exactly this — copy the pattern.
  b) Mark it `UNEXECUTED` with the blocker.
Choose (a) wherever the logic is reachable; it is how the resume contract is
currently proven.

════════════════════════════════
TRAPS THAT PRODUCE FALSE POSITIVES HERE
════════════════════════════════
These have already wasted real time. Check against them before reporting.

1. SCREENSHOTS LIE ABOUT TIMING. The browser pane frequently captures before
   paint or before an effect runs. The activity heatmap auto-scrolls to the
   current week on mount via rAF; a screenshot will often show it scrolled
   left and look broken. Confirm with JS (`scrollLeft`, `scrollWidth`) or
   `read_page` before believing a visual defect. Same for any CSS transition —
   `transition-colors` is 150ms and screenshots catch mid-transition colours.

2. `redirect()` IN A SERVER COMPONENT RETURNS 200, NOT 307. `curl` sees a 200
   with an RSC redirect payload; the browser navigates correctly. Only the
   edge proxy (`src/proxy.ts`) emits a real 307. Verify redirects in a browser,
   not with curl, before calling one broken.

3. 456 IS CORRECT, NOT A BUG. The source sheet contains 456 questions. A "474"
   figure appears in the project's history and could not be substantiated.
   `npm run scrape` asserts the count against the site's own declared total and
   exits non-zero on mismatch. Do not "fix" this.

4. BLANK DIFFICULTY IS INTENTIONAL. The source has no difficulty data, so it is
   seeded empty rather than guessed. There is a picker on each task row to fill
   it in.

5. THE VELOCITY CHART IS DELIBERATELY NOT THEMED. Its two series use fixed
   categorical colours because colour there encodes *identity*; the heatmap and
   difficulty ramps are themed because they encode *magnitude*. The reasoning,
   including the measurements that rejected the themed alternative, is in the
   comment at the top of `src/components/velocity-chart.tsx`. Read it before
   filing an inconsistency.

6. `/preview` RETURNS 404 IN PRODUCTION BY DESIGN. It is a dev harness. Confirm
   the guard works; do not report its existence as a leak without checking.

None of these are permission to skip verification. If you can show one of them
is actually wrong, that is a finding — just bring evidence.

════════════════════════════════
PHASE 1 — CHANGE MAP
════════════════════════════════
Build a precise map from the code you open, not from the README.
  - What each module is responsible for, and what it trusts.
  - Every entry point: pages, API routes, server actions, the edge proxy, the
    scripts. Server actions are entry points — a caller can invoke them with
    any arguments; check what they validate.
  - Contract surface: cookies, status codes, JSON shapes, env vars, the
    Postgres schema, the Notion schema in `src/lib/schema.ts`.
  - What did NOT change / does not exist that you would expect: missing tests,
    missing validation, missing indexes, docs that contradict code.

════════════════════════════════
PHASE 2 — ADVERSARIAL CODE REVIEW
════════════════════════════════
You are trying to break it, not summarize it. Every claim must cite a line you
opened in this session or a command you ran in this session.

1. RE-STATE THE INVARIANT. For each behavior: "it must always be true that …".
   Candidates worth writing down for this app:
     - user A can never read or write user B's Notion data
     - a Notion token is never stored in plaintext and never reaches the client
     - a retried or interrupted seed never creates a duplicate row
     - ticking a question is the only write needed to update every derived view
     - a day boundary is the same regardless of server timezone
     - a database outage never makes the app unreachable
     - flag/skin choice never changes what data a user can see

2. ENUMERATE EVERY ENTRY POINT into changed code, and find callers by searching
   THIS repo. A check on one entry point and not another is a candidate.

3. TRACE, DO NOT SCAN. Follow one real request edge-to-storage-and-back for each
   invariant. Where is authz actually enforced — proxy, page, action, or query?
   Is it the same on read and write? What is trusted at each hop?

4. ATTACK. Wrong tenant, forged ids, stale session, replayed cookie, omitted
   fields, huge/unicode input, double submit, two tabs, concurrent workers,
   partial writes, dependency 500s, rows written by an older schema version.

5. REVIEW THE TESTS AS PRODUCT CODE. `scripts/selftest.ts` has 60 assertions.
   Which invariant does each lock? Can any pass while the bug still exists? A
   missing test for an invariant from step 1 is a finding or a Phase 3 case —
   never silent.

Lenses: authz/tenancy · contract/back-compat · data & migrations · failure and
partial failure · time and concurrency · injection and request safety ·
secrets/PII in logs · rollout and deploy order · operability · cost/perf on hot
paths. Skip a lens only by saying why it cannot apply.

════════════════════════════════
PHASE 2b — FALSE-POSITIVE GAUNTLET (every candidate, twice)
════════════════════════════════
A candidate is not a finding. Try to DISPROVE each one. Prefer killing it.

  G1 Re-open the cited lines on current HEAD. No file:line → it dies.
  G2 Did you misread? Check types, defaults, early returns, the proxy, DB
     constraints, and the caller you skipped. If another layer enforces it, it
     dies unless you can show that layer is skippable from a real entry point.
  G3 Reachable? Name the entry point and the payload. Dead code dies.
  G4 Pre-existing? `git log -p` the path. Not-worsened pre-existing issues are
     noted separately, not headline findings.
  G5 Inventing a requirement? If the invariant is not in the code, the README,
     or a commit message, demote it to a Question.
  G6 Would it actually fail at runtime? Walk the data, not the names.
  G7 Can you trigger it? If it is reachable and you did not run it, run it.
     Unrun + unblocked = it waits or dies.
  G8 Could you prove it to a cold reader in one paragraph? "Seems like it
     might" dies.

Run this once after source review and again after execution. Keep no shadow
list of "minor concerns" that skipped it.

Survivors carry: Severity (Blocker / Should fix / Nice-to-have) · file:line ·
invariant violated · trigger · why the code loses (cited) · why it is not a
false positive · Executed? yes(how) / UNEXECUTED(blocker).

════════════════════════════════
PHASE 3 — TEST PLAN
════════════════════════════════
Matrix per invariant: Actor × Action × Starting state × Surface, flattened to
executable checklist items:

    [ID] Surface | Actor | Setup → Action → Expected. Proves <invariant/finding>.

Actors: anonymous · signed-in · a SECOND user (tenancy) · a user mid-setup ·
a user with a corrupt/undecryptable stored token.
States: no account · account without Notion · provisioning interrupted mid-seed ·
provisioning errored · ready · database unreachable.
Surfaces: `npm run test` · local app · `/preview` harness. No UAT.

Required families:
  - every auth path incl. negatives (401/403 vs redirect)
  - tenancy: user B must not reach user A's data on any route or action
  - the resume contract: interrupt a seed, assert no duplicates on retry
  - upgrade path: old schema → `ensureSchema` → writes still work
  - derived views agree with each other (dashboard vs analytics vs daily)
  - timezone: run `npm run test` under TZ=Pacific/Kiritimati, Pacific/Midway,
    America/Los_Angeles, Asia/Kolkata, UTC — all must pass
  - UI matrix on `/preview`: 3 skins × light/dark × 375px and desktop
  - touch: emulate a mobile device and confirm hover-only controls are reachable
    (`matchMedia('(hover: none)')` should be true)
  - accessibility: keyboard-only tick, focus rings, `aria-live` announcements,
    `prefers-reduced-motion`
  - loading skeletons, error boundary, not-found, `/preview` 404 in production
  - kill-shot: one case per surviving finding whose job is to reproduce it

Tag `DESTRUCTIVE` anything that writes to a real external service. Do not run
those.

════════════════════════════════
PHASE 4 — EXECUTE
════════════════════════════════
A plan you did not run is not a test. A screenshot is not a test.

Record HEAD SHA. Boot and wait for real health (port listening, a 200 from
`/login`), not for the command to spawn.

Persistence rule: every successful write is followed by an INDEPENDENT read —
a different request, page, or a `psql` query. A 200 or a success toast is not
evidence anything was stored.

On fail: re-run once. Fails twice = Fail. Passes on retry = Flake, still
reported. Blocked = Not verified, never Pass.

Then run the gauntlet again (Phase 2b) on every surviving finding. A kill-shot
that does not reproduce KILLS the finding — move it to "Killed as false
positive" with what you ran.

════════════════════════════════
PHASE 5 — REPORT, THEN COMMIT
════════════════════════════════
Write the report to:

    docs/reviews/YYYY-MM-DD-e2e-review.md

Sections, in order:

  ## Verdict          Block / Request changes / Approve with nits / Approve,
                      plus one paragraph on real merge risk.
  ## Independence     SHA, files opened, commands run. Confirm no other chat
                      context or GitHub threads were used.
  ## Scope            Branch, HEAD SHA, "UAT: not deployed".
  ## Change map       Behavior, blast radius, invariants tested.
  ## Findings         Gauntlet survivors only. Table, worst first. Prose note
                      for Blockers only.
  ## Killed as false positive
                      Required even if empty. What you almost reported and why
                      it died.
  ## E2E results      Checklist with Pass / Fail / Blocked.
  ## Tests I ran      Exact commands and outcomes.
  ## Not verified     What you could not prove and what is needed to prove it.
  ## Assumptions I made
                      Every decision taken because I was offline.
  ## Questions        Real ones only. Do not hide findings here.

No padding, no praise. Then:

    git add docs/reviews/
    git commit        # message: what you reviewed and the verdict
    git push origin main

Never `--force`. If `.env.local` or any secret would be staged, stop — it is
gitignored and must stay that way. Verify with
`git diff --cached | grep -iE 'ntn_|SESSION_SECRET=|ENCRYPTION_KEY=|postgresql://'`
before committing.

If you also fixed defects, commit the fixes SEPARATELY from the report, and
only fixes you proved with a failing-then-passing test.

Finally: stop the throwaway Postgres and the dev server.
```
