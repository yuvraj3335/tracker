# Written question guides

The tracker keeps the 455 questions in `data/a2z-seed.json`. Do not replace that
list with the current Striver list or change progress, notes, IDs or ordering.
`index.json` keys are the pinned seed's one-based global order; lookup uses the
question's Codolio source ID, not its current database position.

## Reference and writing requirements

Use the public lesson linked from the user's Striver A2Z sheet:
https://takeuforward.org/prep-hub/strivers-a2z-dsa-sheet?page=sheet

The public sheet had 495 entries when inspected on 2026-10-28. The saved
`striver-reference.json` contains its titles and links, not article content.
A URL appearing there does **not** mean its lesson has been reviewed.

For each question:

1. Match the actual problem, constraints and required output. Similar names do
   not prove a match. If the tracker link and title disagree, state both variants
   clearly. Do not silently replace the tracker's question.
2. Read the public lesson and its Java tab. Use the same taught algorithms and
   progression. Follow source links only where available; do not bypass paid
   lessons or invent what an unavailable lesson says.
3. Write original explanations and Java implementations. Do not reproduce full
   third-party articles, comments, diagrams or distinctive code. Keep standard
   algorithm structure recognisable and link the lesson for its exact code.
4. Teach with short sentences and concrete values. Explain what a variable
   remembers, why a branch is taken, and what makes the next step safe. Avoid
   dense one-line Java and unexplained terms such as "invariant" or "recurrence".
5. Include a worked example, approaches, runnable Java, complexity and useful
   edge cases. Add a small `trace` table when it clarifies changing pointers or
   state. Use optional `baselineJava` and `better` for earlier approaches.
6. Record `reference` only after checking the lesson. Its `approach` records
   what was checked; `adaptation` explains any intentional change. Never use
   this metadata to imply a human expert reviewed AI-authored work.
7. Execute Java checks for every displayed implementation. Include the visible
   example and edge cases; compare optimised algorithms with a simpler oracle
   where practical. A compile-only check is insufficient.

There is no first-use article generation. Content is saved with the repository
and reviewed before publication. Questions without a written guide show an
honest preparation state and their existing resources.

## Validation

- `node scripts/check-guides.mjs`: validate schema and report written coverage.
- `node scripts/check-guides.mjs --java`: compile every displayed Java method and
  execute assertions with a JDK. GitHub Actions runs this on guide changes.
- `node scripts/check-guides.mjs --complete`: fail unless all 455 are written.

Coverage and source review are separate: report both accurately. A passing
suite checks the supplied cases; it is not a proof that every explanation is
correct or that every possible input has been tested.
