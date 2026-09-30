---
name: job-hunt
description: Find software jobs, judge whether each is worth applying to, and track applications with the Job Switch Tracker. Use when the user asks to find, search or fetch jobs (LinkedIn, Naukri, foundit/Monster, Glassdoor, Wellfound, Workday, Greenhouse, Lever, Ashby or company career sites), pastes a job link or asks whether a job is worth it or to evaluate one, says they applied somewhere, got a reply, OA, interview, rejection or offer, wants to update their job profile or resume, or asks what to follow up on.
---

# Job hunt

Everything goes through the `job-hunt` MCP server (the local connector in
`connector/job-hunt.mjs`). It exposes the tracker's tools plus the ones that
need Crawl4AI on this computer.

1. **Call `get_job_hunt_playbook` first and follow it exactly.** It is the
   single source of truth for how searches are run, scored, saved and reported,
   and it is the same playbook every other AI tool gets.
2. Judge before recommending. Every listing you keep gets a quick look (an
   `evaluation` on `add_jobs`); the promising ones get a full read with
   `evaluate_job`. You score the rubric; the tracker computes the match and the
   verdict (Apply, Consider, Research first, Skip). The verdict is advice —
   never change a job's status because of it.
3. Board searches (`search_job_boards`) crawl LinkedIn, Naukri, foundit,
   Glassdoor and Wellfound through Crawl4AI and take 20–60 seconds. Company
   career sites (`search_company_jobs`) are fast. Use both.
4. If anything fails — a tool is missing, Crawl4AI is down, the key is
   rejected — call `check_job_hunt_setup` and relay its fix. Setup commands, from
   the repo root:
   - `npm run crawler:setup` — start Crawl4AI in Docker (localhost only)
   - `npm run check:boards` — live check of every board
   - `npm run connect` — config for Codex, Gemini CLI, Cursor, Claude Desktop
5. If the `job-hunt` server is not connected at all, ask the user to approve it
   in `/mcp` (it is declared in this repo's `.mcp.json`).

Never apply to a job, send a message or email, or sign in anywhere on the
user's behalf. Job-search data goes only into the tracker, never into any other
Notion workspace or document the environment happens to have access to.
