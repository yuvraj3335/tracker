# Job Switch Tracker

A multi-tenant DSA + interview-prep tracker. Each person signs up, connects
**their own Notion**, and the app builds the tracker inside it.

Built around one principle: **you log one thing, and everything else is derived.**
Ticking a question stamps `Completed On`, and that single date produces the Daily
Tracker entry, the activity heatmap cell, the streak, and the rollup into overall
Job Switch progress. There is never a second place to log.

---

## ⚠️ The question count is 456, not 474

The source at [a2zdsa.pages.dev](https://a2zdsa.pages.dev/) contains **456
questions**, not the 474 originally specified.

This is not a scraping shortfall:

- The site **declares its own total as 456** (`totalQuestions: 456` in its bundle).
- All **18** sections' declared subtotals match their actual contents exactly.
- `npm run scrape` asserts both and **exits non-zero** if either disagrees.

Three different numbers are in circulation:

| Source | Count |
| --- | --- |
| `a2zdsa.pages.dev` (this app's source) | **456** questions |
| `takeuforward.org` (official, restructured) | 442 topics / 19 modules / 95 sections |
| Originally specified | 474 |

474 could not be substantiated against any live source, so nothing was padded to
reach it. If you find the list that has 474, drop it in and re-scrape.

**There is also no difficulty data.** The source carries none — the only
`difficulty` strings in its bundle are query parameters inside GeeksforGeeks
URLs. So `Difficulty` exists as an `Easy / Medium / Hard` select on every
question but is **seeded blank** rather than guessed at. Fill it in as you go and
the analytics light up on their own.

**What the source does give, faithfully:** 18 sections → 61 headings → 456
questions in original order; headings stored as **categories, never counted as
questions**; the **33 questions with no URL** all retained and labelled; original
names and all four link types preserved verbatim; pure A2Z, with Striver's
separate pattern-based sheet not mixed in.

---

## Architecture

```
  browser ──► Next.js on Vercel ──┬──► Postgres   accounts + encrypted tokens
                                  └──► Notion     ALL tracker content (per user)
```

**Postgres holds only what Notion cannot:** usernames, password hashes, and each
user's encrypted Notion token. It never stores a question, a completion or a
date. Delete the database and every user's actual progress still sits safely in
their own Notion.

**Why the server talks to Notion, never the browser:** a Notion token grants
read/write to that user's whole workspace. It never reaches the client.

**Tenant isolation.** Every Notion read and write takes an explicit `Tenant`
(`src/lib/tenant.ts`). There is no ambient "current token" anywhere, and the
Notion response cache is keyed by user id, so one account cannot be served
another's data.

### Security

| Concern | How it's handled |
| --- | --- |
| Passwords | `scrypt` with a per-user random salt; constant-time comparison |
| Notion tokens | AES-256-GCM encrypted at rest, decrypted only to call Notion |
| Sessions | HMAC-SHA256 signed cookie, `httpOnly`, 30-day expiry |
| User enumeration | A missing username verifies a decoy hash, so timing matches |
| Open redirects | one `safeNextPath` for every caller; `//host`, `/\host` and tab/newline-smuggled variants all collapse to `/`, and POST redirects are 303 so a form body is never replayed |
| Write scope | Task writes verify the page belongs to that tenant's Tasks table |
| Fail closed | A missing `SESSION_SECRET` rejects every session rather than allowing all |

Rotating `SESSION_SECRET` signs everybody out. Rotating `ENCRYPTION_KEY` makes
stored Notion tokens unreadable and users must reconnect — deliberately, because
losing the tokens beats keeping them readable.

---

## Interface

**Loading.** Reading a tracker takes five paginated Notion calls, so a first
load is not instant. Every data route has a skeleton that mirrors its real
layout, so nothing jumps when the data lands.

**Failure.** Notion rate-limits and occasionally times out. A route-level error
boundary catches that with a retry rather than the browser's raw server-error
page. The root layout also treats a database outage as "signed out" instead of
throwing — an unguarded throw there would have 500'd every page, including
`/login`.

**Touch.** Bookmark and revisit used to be revealed on hover, which meant they
were invisible and unreachable on a phone. They are now visible by default, and
only devices that actually report `hover: hover` fade them until the row is
hovered.

**Hierarchy.** The dashboard opens on a hero: a progress ring with the
percentage stated in text at its centre (the ring reinforces, it never carries
the value alone), a time-aware greeting, and today / streak / to-go beside it.

**Colour roles.** Two different jobs, handled differently:

| Encoding | Role | Themed? |
| --- | --- | --- |
| Heatmap, difficulty, progress bars | magnitude → sequential, one hue | yes, per skin |
| Velocity chart series | identity → categorical slots | no, fixed |

Colour in the velocity chart means *which series*, and that should not repaint
when someone changes theme. Using a skin's accent there was tried and measured:
accents are chosen for UI contrast, not as series slots, and both miss the
categorical gates (Rampart's teal reads gray at chroma 0.091 against a 0.1
floor; Blossom's violet sits above the dark lightness band at L 0.681 vs 0.67).

### Dev harness

`npm run dev` then open **`/preview`** — every component with sample data, in
whichever skin and mode you pick. It is how the UI gets reviewed without a live
Notion workspace. The route returns 404 when `NODE_ENV` is production, so it is
not part of the shipped app.

---

## Themes

Three skins, switchable from the palette icon in the nav (and on the setup
screens, since setup takes a few minutes). A skin is a **second axis** alongside
light/dark — `data-skin` × `data-theme` — so each of the three works in both
modes.

| Skin | Feel | Mascot |
| --- | --- | --- |
| **Studio** | Clean and quiet. The default. | none |
| **Rampart** | Stark and military. Teal on charcoal, 4px corners. | a hooded scout |
| **Blossom** | Soft and sparkly. Violet pastels, 18px corners, blush and stars. | a floating sprite |

A skin changes more than colour: surfaces, ink, accent, the heatmap ramp, the
difficulty ramp **and the corner radius**, so Rampart reads sharp and Blossom
reads round.

**Tick a question and the mascot jumps** — a squash-and-stretch hop with a
sparkle burst and a line in that theme's voice ("Advance." vs "Yay! ✨"). Finish
every question under a heading and you get the bigger milestone version with an
impact ring. Lines rotate rather than shuffle, so the same one never lands twice
running. Taking a completion back gets the quietest thing the overlay can do —
the character looks sad for a moment and says so, with no sound and no sparks.

The celebration fires **optimistically**, before Notion replies — the reward has
to land with the tap, not a second later.

### Notes

- **The artwork is original.** Both mascots are drawn from scratch as SVG and
  painted entirely with theme tokens, so they restyle themselves and there is no
  per-theme artwork to maintain. They evoke a genre rather than copying any
  studio's characters — which is what makes this safe to deploy publicly.
- **So is the third one.** `Miso` is a rendered character rather than an SVG —
  a small apprentice wizard with a floppy pointed hat, a staff with a lit orb,
  and a hat point that droops further the worse things are going. The
  proportions are stylised rather than super-deformed: about two and three
  quarter heads tall, with a neck, a waist, jointed arms and visible legs. The
  head is still larger than life because the face has to survive being drawn
  60 pixels wide, but everything below it is built like a figure.
  It is not downloaded artwork — every vertex, material and animation clip is
  generated by `scripts/make-character-model.mjs`, which is in this repo, so
  its provenance is readable rather than asserted. Its six poses are clips on
  one rig, which is what makes them the same character in six states by
  construction rather than by six drawings agreeing with each other. Pick it
  from the sparkle icon in the nav.
**The companion.** `Miso` comes loose onto the page: drag it anywhere, poke it,
or click it to talk. Position is per device and is clamped on every read, so a
spot saved on a wide window cannot strand it off-screen. Arrow keys nudge it,
Shift+arrow moves it further and Home sends it back to the corner — dragging is
never the only way in.

**Clicking it starts a spoken conversation.** It says hello out loud, listens,
answers, and listens again, hands-free, until you stop it. The figure is the
status indicator — it talks while it talks, leans in while it listens, casts
while it thinks — and every turn is captioned on screen as well. Typing still
works and is the only path in a browser without speech recognition.

**It can see your tracker.** Ask how many you have done, how the hard ones are
going, what you are part-way through, what is next — it answers from the real
numbers, derived through `derive.ts` so what it says out loud and what the
dashboard shows cannot drift apart. It is read server-side, never taken from
the browser, and it is told to use those numbers and only those: rounding a
streak up to be encouraging is the one thing it must never do. If Notion is
slow or down the conversation still works, it just says it cannot see.

Talking needs `ANTHROPIC_API_KEY` (Claude Haiku); without one it says so
plainly rather than failing.

- **Accessible.** The overlay is `position: fixed` and `pointer-events: none`, so
  it can never block a tap or shift the page, and every message goes through an
  `aria-live` region so it is announced rather than purely visual. All animation
  is transform/opacity only and is switched off wholesale by
  `prefers-reduced-motion`.
- **Validated colour.** `npm run check:color` reads `globals.css` and checks all
  six skin x mode combinations: text floors (4.5:1), control boundaries and
  focus rings (3:1), difficulty chip ink against its own chip, heatmap ramp
  lightness monotonicity and step size, and the 2:1 ordinal floor against that
  skin's own surface. 162 checks. It is a script rather than a claim because
  the claim had drifted — see the commit that added it.
- Skin choice is per-device (localStorage), like light/dark.

---

## Setup

### 1. Database

**On Vercel:** Storage → Neon → create. The integration injects the connection
string for you. Whatever env-var prefix you pick when connecting it, the app
finds it: `DATABASE_URL` wins if set, then `POSTGRES_URL`, then any
`<PREFIX>_DATABASE_URL` or `<PREFIX>_POSTGRES_URL` (see `resolveDatabaseUrl`).
Connect the store to Preview as well as Production if preview deploys should
be able to sign people in.

**Locally:** any Postgres works — the driver switches on the URL (Neon's HTTP
driver for `*.neon.tech`, standard `pg` over TCP otherwise).

The schema creates itself on first signup; there is no migration step.

### 2. Secrets

```bash
npm run keygen   # prints SESSION_SECRET and ENCRYPTION_KEY
```

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL`, both generated secrets, and `APP_TIMEZONE`.

### 3. Run

```bash
npm install && npm run dev
```

Then sign up and follow the four-step setup. **No CLI seeding** — connecting
Notion and inserting all 456 questions happens in the browser.

### 4. Deploy

Import the repo into Vercel and set: `DATABASE_URL`, `SESSION_SECRET`,
`ENCRYPTION_KEY`, `APP_TIMEZONE`.

---

## What each user does once

1. **Sign up** — username + password.
2. **Paste a Notion integration secret** — from
   [notion.so/my-integrations](https://www.notion.so/my-integrations). Checked
   against Notion before it is stored, so typos surface immediately.
3. **Paste a Notion page link** — after adding the integration under that page's
   **••• → Connections**. (This is the step people miss; without it Notion
   reports the page does not exist.)
4. **Wait a few minutes** while 456 questions are written.

### Why seeding is chunked

456 questions means 456 individual page creations — Notion has no bulk insert
and allows roughly 3 requests/second, so the job takes minutes. That is far
longer than a serverless function may run, so the browser requests one small
chunk at a time and draws a progress bar.

`provisionCursor` indexes one flat, deterministically ordered question list, so
closing the tab and returning **resumes** rather than restarting or
double-inserting.

The cursor alone is not enough, because reading it, writing rows and saving it
back is a read-modify-write. Two tabs both read the same value and both write
the same questions, and re-running setup against a Tasks database that already
exists would rewind to zero. So a chunk is claimed with a conditional update
(`provision_lock`) — one request at a time, per user — and the cursor only
rewinds when the Tasks database is genuinely new. Both were measured, and both
used to duplicate rows.

---

## How it fits together

```
Areas          Topics              Tasks
(prep areas)   (the 18 sections)   (the 456 questions)
     │              │                   │
     └──────────────┴───────────────────┘
                    │
              Completed On  ←── the only input
                    │
     ┌──────────────┼──────────────┬─────────────┐
     ▼              ▼              ▼             ▼
Daily Tracker   Heatmap        Streaks      Job Switch %
```

**Adding a prep area later** needs no schema change and no rebuild. Add a row to
the **Areas** database in Notion, then its Topics and Tasks. It appears on the
dashboard and folds into overall progress automatically.

Overall progress is `Σ(weight × done) / Σ(weight × total)`. With every weight at
`1` that is just "everything done / everything", so a new area contributes
proportionally to its size. Bump an area's `Weight` to make it count for more.

**The Daily Tracker** is derived, not entered — a Notion calendar view keyed on
`Completed On`, and in the app a per-day view with a prev/next switcher.

**The heatmap** is 53 weeks × 7 days built from Notion activity, **not** GitHub's
API. Any cell links to that day's list.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run test` | 541 self-tests: crypto, sessions, redirect safety, cursor maths, timezones, derived stats, moods, timer maths, search, keyboard, characters |
| `npm run keygen` | generate `SESSION_SECRET` + `ENCRYPTION_KEY` |
| `npm run scrape` | re-scrape the sheet; fails loudly on any integrity mismatch |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm run check:color` | 162 contrast/ramp checks, read out of `globals.css` |
| `npm run check:schema` | upgrades a database built from the original schema and checks writes still land |
| `npm run fixtures:characters` | placeholder characters for exercising the character pipeline (`clean` removes them) |
| `npm run make:character` | regenerates the shipped character's model and `meta.json` from source |

`npm run test` is timezone-sensitive by design — it passes from UTC−11 to UTC+14.
`check:schema` needs a `DATABASE_URL` it may create a scratch database on; it
creates and drops its own and never touches yours.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Notion API
(`@notionhq/client` v5, data-source model) · Neon / Postgres · `date-fns`.

No chart library — the heatmap and velocity chart are hand-rolled, so the client
bundle stays small. `three` / `@react-three/fiber` / `@react-three/drei` are the
one exception, and they sit behind a dynamic import that only resolves when the
selected character ships a model: `/login` downloads 593 KB of chunks and the
971 KB renderer is not one of them. Colors come from a palette validated for lightness band,
chroma floor, colour-vision-deficiency separation and contrast **against each
surface it renders on, in both light and dark mode**. Dark mode is a selected set
of steps, not an automatic inversion.

Responsive: bottom tab bar on phones (inside the iOS safe area), top nav on
laptops.

## Data provenance

`data/a2z-seed.json` is generated by `scripts/scrape-a2z.mjs`, which reads the
dataset out of the site's own JS bundle rather than parsing rendered HTML — so
the hierarchy and ordering are exactly the site's, not inferred. The file records
its source URL, the content-hashed bundle it came from, and the scrape timestamp.
