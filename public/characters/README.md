# Characters

Drop a folder in here and the app picks it up. Nothing in `src/` lists
characters — discovery is a filesystem walk, so adding art never means editing
code.

**This folder ships one character, and it is not installed artwork.** `pip/`
is generated in full by `scripts/make-character-model.mjs` — every vertex,
material and animation clip — which is why it is the single, narrowly-scoped
exception to the ignore rule on this directory. Everything else you drop in here
stays ignored.

With no character *selected*, the app falls back to the original SVG mascots in
`src/components/mascot.tsx`, which are drawn from scratch and themed from design
tokens. That is still the default look, not a degraded one.

---

## You are responsible for the rights

Whoever runs this instance is responsible for holding the right to use whatever
they put in this folder. The app will display the `artist`, `source` and
`license` you record in `meta.json` on a credits screen reachable from the
picker, but recording a licence is not the same as having one.

If you are adding **Genshin Impact** or other HoYoverse characters, the relevant
permission is HoYoverse's own fan-art / fan-content policy and their official
fan kit. Use art you drew, art you commissioned, or art whose creator has
allowed this use — and credit them. Do not hotlink or copy assets straight out
of the game client.

Nothing here is checked into git beyond this README, and nothing is fetched from
the network at build or runtime.

---

## Layout

```
public/characters/
  my-character/
    meta.json         required
    idle.webp         required
    celebrate.webp    optional — falls back to idle
    milestone.webp    optional — falls back to celebrate, then idle
    sad.webp          optional — falls back to idle
    concerned.webp    optional — falls back to sad, then idle
    focused.webp      optional — falls back to idle
    crying.webp       optional — falls back to sad, then idle
    laughing.webp     optional — falls back to celebrate, then idle
    angry.webp        optional — falls back to idle
    floating.webp     optional — falls back to idle
    jumping.webp      optional — falls back to celebrate, then idle
    casting.webp      optional — falls back to focused, then idle
```

The **folder name is the character id**. It must be letters, digits, `-` and `_`
only, and it wins over any `id` field inside `meta.json`, because the folder name
is what the image URLs are built from.

A folder with no `idle` image, no `meta.json`, malformed JSON, or a missing
`artist` / `license` is skipped with a warning on the server console. It never
breaks the page; the mascot fallback covers it.

## Poses, and when each one shows

| Pose | Shown when |
| --- | --- |
| `idle` | Resting: the dashboard hero, empty states, the picker thumbnail. |
| `celebrate` | A question is ticked. |
| `milestone` | A heading or section is finished — the bigger moment. |
| `sad` | You come back after a streak has broken. Used gently, once. |
| `concerned` | Your pace has dropped well below your own recent average. Softer than `sad` — nothing has actually lapsed yet. |
| `focused` | A focus-timer session is running. The one pose that means "right now", rather than "lately". |
| `crying` | A completed question is taken back off. Brief and quiet — it notices, it does not scold. |
| `laughing` | The companion is double-tapped. |
| `angry` | The companion is poked repeatedly in a short span. |
| `floating` | The companion is picked up and being dragged. |
| `jumping` | The companion is put back down, or nudged with the keyboard. |
| `casting` | The companion is working out a reply. |

Only `idle` is required. A character with just `idle.webp` works everywhere;
every other pose resolves through the fallback chain above, so a missing file is
never a 404. Drawing `idle`, `celebrate` and `sad` covers all twelve sensibly:
`milestone`, `laughing` and `jumping` borrow `celebrate`, `concerned` and
`crying` borrow `sad`, and `focused`, `casting`, `angry` and `floating` fall
back to `idle`.

## A rendered model instead of images

A character can ship one `model.glb` (or `model.gltf`) rather than pose images.
Then the poses are **animation clips inside the file**, named exactly as the
poses are — `idle`, `celebrate`, `milestone`, `sad`, `concerned`, `focused` —
and a clip that is not there falls back through the same chain a missing image
would. A model with only an `idle` clip is as valid as a folder with only
`idle.webp`.

```
public/characters/
  my-character/
    meta.json         required
    model.glb         poses are clips inside it
```

A model wins over pose images; the two are not merged. Nothing else changes:
`meta.json` is validated identically, the credits screen shows the same fields,
and a character with neither a model nor an `idle` image is skipped.

The renderer (three.js, via `@react-three/fiber`) sits behind a dynamic import
and is only fetched when the selected character actually has a model — an
install with no model character never downloads it. See
`src/components/character-canvas.tsx`.

## Image requirements

- **Format:** `.webp` preferred. `.avif`, `.png`, `.jpg` and `.jpeg` also work —
  the first one found wins, in that order.
- **Dimensions:** square, **512×512** recommended (256×256 minimum). The app
  renders figures between 40px and 96px and serves resized versions through
  `next/image`, so anything larger than 512 is wasted bytes.
- **Background:** transparent. Figures sit directly on themed surfaces, and a
  white box will look like a bug in dark mode.
- **Framing:** keep the character centred with a little headroom. The celebration
  animation scales and hops the figure from its bottom edge, so art that bleeds
  to the frame edge will clip.
- **Weight:** aim under ~80 KB per pose. These load on the dashboard.

## meta.json

```json
{
  "id": "my-character",
  "name": "My Character",
  "artist": "Artist name",
  "source": "https://example.com/where-this-came-from",
  "license": "e.g. HoYoverse fan-content policy, or CC BY 4.0, or commissioned",
  "accent": "#7c4dcc",
  "lines": {
    "cheer": ["Nice.", "Another one down."],
    "milestone": ["That whole section is finished."],
    "idle": ["Still here. Still going."]
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | no | Defaults to the folder name. |
| `artist` | **yes** | A character without a credit is skipped. |
| `source` | no | Rendered as a link when it starts with `http`. |
| `license` | **yes** | Free text — whatever actually applies. |
| `accent` | no | `#rgb` or `#rrggbb`. Anything else is ignored. |
| `lines` | no | Character voice. Falls back to the skin's copy per kind. |

`lines` entries replace the skin's own copy for that kind only, so a character
with just `cheer` lines still uses the skin's milestone copy. Empty strings are
dropped.

## After adding one

Discovery is cached for the life of the server process, so **restart
`npm run dev`** after adding or removing a folder.
