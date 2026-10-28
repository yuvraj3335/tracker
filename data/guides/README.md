# Written Java question guides

`index.json` contains original authored explanations keyed by the one-based
order in the pinned Codolio seed. Runtime resolution first uses stable source
IDs; changing sheet order in Notion does not change which article is selected.
Do not rescrape/reorder the seed without migrating these keys.

Every published article needs a precise variant, a worked example, a baseline,
reasoning and steps, Java implementation, complexity, pitfalls and executable
Java assertions. Cases must cover boundaries and demonstrate the stated
example. Compilation and examples are evidence, not a proof of all behavior.
Do not label generated-on-demand output as reviewed article content.

Run `node scripts/check-guides.mjs --java` with a JDK, or use the repository's
cloud workflow. `--complete` additionally requires all 455 question entries.
Questions without articles must show an honest preparation state, never an
invented solution or a generic template labelled complete.
