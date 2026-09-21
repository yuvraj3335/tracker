# Job Switch Tracker

A DSA + interview-prep tracker. **Notion is the database, this app is the UI.**
Tick a question in either place and both agree.

Built around one principle: **you log one thing, and everything else is derived.**
Marking a question done stamps `Completed On`, and that single date produces the
Daily Tracker entry, the activity heatmap cell, the streak, and the rollup into
overall Job Switch progress. There is never a second place to log.

---

## ⚠️ Read this first: the question count is 456, not 474

The source at [a2zdsa.pages.dev](https://a2zdsa.pages.dev/) contains **456
questions**, not the 474 that was originally specified.

This is not a scraping shortfall:

- The site **declares its own total as 456** (`totalQuestions: 456` in its bundle).
- All **18** sections' declared subtotals match their actual contents exactly.
- `npm run scrape` asserts both and **exits non-zero** if either disagrees.

For reference, three different numbers are in circulation:

| Source | Count |
| --- | --- |
| `a2zdsa.pages.dev` (this app's source) | **456** questions |
| `takeuforward.org` (official, restructured) | 442 topics / 19 modules / 95 sections |
| Originally specified | 474 |

474 could not be substantiated against any live source, so nothing was padded to
reach it. If you find the list that has 474, drop it in and re-seed.

### There is also no difficulty data

The source carries **no difficulty field at all** — the only `difficulty` strings
in its bundle are query parameters inside GeeksforGeeks URLs. So `Difficulty`
exists as an `Easy / Medium / Hard` select on every question but is **seeded
blank**, rather than guessed at. Fill it in as you go and the analytics light up
on their own. (The official takeUforward sheet does have real difficulty, but
it is behind a login.)

### What the source *does* give you, faithfully

- **18 sections → 61 headings → 456 questions**, in the original order
- Headings ("Arrays Basic to Medium", etc.) are stored as **categories and are
  never counted as questions**
- **33 questions have no URL of any kind** — all retained, and shown as
  *"no link on the source sheet"*
- Original names, ordering, sections, headings and all four link types
  (takeUforward / LeetCode / GFG / YouTube) preserved verbatim
- Pure A2Z content — Striver's separate pattern-based sheet is not mixed in

---

## Setup

### 1. Notion integration

1. Create an **internal integration** at
   [notion.so/my-integrations](https://www.notion.so/my-integrations) and copy its
   secret.
2. Create a **blank Notion page** to hold the databases.
3. On that page: **`…` menu → Connections → add your integration.**
   Skipping this is the single most common cause of a `404` from the API.

```bash
cp .env.example .env.local
# put NOTION_TOKEN=ntn_... in .env.local
```

### 2. Seed

```bash
npm install
npm run scrape   # optional; data/a2z-seed.json is already committed
npm run seed -- --parent "<your-notion-page-url>"
```

This creates four databases, adds the rollups, builds a set of Notion views, and
inserts 1 area + 18 topics + 456 questions. It takes **~4 minutes** — Notion's API
allows roughly 3 requests/second and there is no bulk insert.

It is **safe to re-run.** Rows are matched on a composite `Source Id`, so an
interrupted seed resumes instead of duplicating. Database ids are written
straight into `.env.local`.

### 3. Run

```bash
npm run dev
```

Set `DEMO_MODE=1` in `.env.local` to browse the whole app with plausible fake
progress and **no Notion connection at all** — useful for previewing a deploy
before the databases exist.

### 4. Deploy to Vercel

Import the repo, then set these environment variables:

| Variable | Value |
| --- | --- |
| `NOTION_TOKEN` | your integration secret |
| `NOTION_AREAS_DS` | from `.env.local` after seeding |
| `NOTION_TOPICS_DS` | ” |
| `NOTION_TASKS_DS` | ” |
| `NOTION_DAILY_DS` | ” |
| `APP_PASSWORD` | pick one — see below |
| `APP_TIMEZONE` | `Asia/Kolkata` |

**Set `APP_PASSWORD`.** The deployment can write to your Notion, so leaving it
blank leaves that open to anyone who finds the URL. The cookie stores a SHA-256
derivation, never the password itself.

`APP_TIMEZONE` decides when a day rolls over for streaks, the heatmap and the
Daily Tracker. Get it wrong and late-night sessions land on the wrong day.

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

### Adding a prep area later

No schema change, no rebuild. In the **Areas** database add a row — name, a
slug, `Status = Active` — then add its Topics and Tasks. It appears on the
dashboard and folds into overall progress automatically.

Overall progress is `Σ(weight × done) / Σ(weight × total)`. With every weight at
`1` that is just "everything done / everything", so a new area contributes
proportionally to its size. Bump an area's `Weight` to make it count for more.

### The Daily Tracker

Derived, not entered. In Notion it is a **calendar view keyed on `Completed On`**;
in the app, `/daily` groups a day's questions by section and gives you a
prev/next day switcher plus a list of every active day.

### The heatmap

53 weeks × 7 days, built from Notion activity — **not** GitHub's API. Any cell
links to that day's list.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run scrape` | re-scrape the sheet; fails loudly on any integrity mismatch |
| `npm run seed` | create + seed the Notion databases (resumable) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Notion API
(`@notionhq/client` v5, data-source model) · `date-fns` / `date-fns-tz`.

No chart library — the heatmap and velocity chart are hand-rolled, so the client
bundle stays small. Colors come from a palette validated for lightness band,
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
