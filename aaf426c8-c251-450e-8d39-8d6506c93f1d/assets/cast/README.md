# Cast image catalog and scene setup

The player chooses a picture for each person from this catalog, using a scene `setup` (who or what to look at) plus optional pose and gaze overrides.

| File | Role |
|---|---|
| `images.json` | Hints for every year-01 cast picture: runtime files used by S1–S6, and the full pose export (12 people × neutral/wave/explain/listen + talking APNG, plus professor close-ups). |
| This README | Vocabulary, height rule, `setup` schema, resolver rules, and known gaps. |

Scene storyboards stay in `viewer/assets/scenes/`. The storyboard README points here for `setup`. `viewer/scene_schema.py` and `TLIScenePlayer.validateStory` check the same `setup` shape.

The public Pages copy receives this folder and the runtime pictures under `media/characters/year-01/`. It does not receive `exports/cast-year-01/`. Entries with `"bundle": "export"` stay in the catalog as hints for later use; the player skips a file that is not on the site.

## How scenes pick pictures today

Each actor names `sprites.idle` (neutral PNG) and `sprites.speak` (talking APNG). A scene `placements` row names the person, `x`/`y` (percent, feet on the point), optional `scale` and `facing`. While a line plays, that speaker uses the talking picture; everyone else uses idle. The catalog does not replace those sprite keys; it adds hints so the resolver can swap in a better pose or a mirrored copy, and can scale people by height.

## Image hints

Each entry in `images.json` has:

| Field | Meaning |
|---|---|
| `lookingAt` | Gaze in the picture itself: `left`, `right`, `front`, `down`, or `up`. Left and right are toward the viewer's screen left and right. |
| `facing` | Body direction, same vocabulary, when it is not the same as a straight front stance. |
| `pose` | One or more tags from the vocabulary below. |
| `heightCm` | Character height in centimetres at Grade 1 / story year 0. |
| `estimated` | Always `true` in this catalog (see height). |
| `posture` / `postureFactor` | Current year-01 poses are all standing (`1`). Sitting would use about `0.7`. The player multiplies height by this factor when scaling people relative to each other. |
| `mirrorable` | `true` unless a horizontal flip would be wrong (text, or an asymmetric cultural detail). A mirrored picture flips left↔right gaze and facing. |

Pose vocabulary: `standing`, `sitting`, `walking`, `sampeah`, `waving`, `pointing`, `holding-book`, `holding-basket`, `giving`, `receiving`, `talking`, `listening`, `neutral`. Extra tags are allowed when the picture clearly shows them.

Every still was opened, and every APNG was opened at its first frame, when the hints were filled. Do not invent a gaze that is not in the file.

### Height source

- **Bora and Sreyneang:** `process/cast/cast.json` gives `baselineAge` 6 at Grade 1 (story year 0). Height uses the WHO Child Growth Standards (2006/2007) height-for-age median at 6.0 years: **116 cm** (boys), **115 cm** (girls). Marked `estimated: true` because the baseline is “about 6” at official entrance, not a birthday.
- **Feet (t228):** every full-body picture has `feetFacing` (by eye) and `feetMeasured` (pixels, from `tools/measure_cast_bboxes.py`). Feet may never point away from the face; see `feetAudit` in `images.json`. Kru Sopheak's and the professor's right-looking poses and `srey-mom-listen` were redrawn so the toes point right; `kru-sopheak-walking-right` was redrawn walking right.
- **Bopha:** a classmate of the twins, about 6 like them (decided 2026-11-11), drawn at their height: 115 cm like Sreyneang. Her pictures were enlarged to the twins' visible height (about 869 px on the 960×1440 canvas).
- **Everyone else:** no baseline age is recorded. Height is estimated from the year-01 `relative_scale` in `exports/cast-year-01/tools/chars.json` (also in `manifest.json`), anchored to Bora: `heightCm = round(116 × scale / 0.7)`.
- Yeay Chan 146, Kru Sopheak 166, Professor Mordechai 159, Dara 139, Sopha 156, Vuthy 166, Visal 162, Srey Mom 154.

`mirrorable` is `false` for Yeay Chan, Malis, and Srey Mom: each wears a krama over one shoulder. Kru Sopheak’s green book has no text and may be mirrored.

The professor’s full-body export slot named `wave` is a **sampeah**, not a hand wave.

## Scene `setup`

A scene may have a `setup` object. It records the main subject (who / what / where) so people can look at it.

```json
"setup": {
  "what": "Asking for a book and saying thank you",
  "where": "Classroom, sharing a book",
  "who": ["bora", "sreyneang", "kru-sopheak"],
  "focus": ["book", "kru-sopheak", "bora"],
  "gaze": "focus",
  "objects": [
    { "id": "book", "label": "a book", "x": 36, "y": 78 }
  ],
  "people": [
    { "id": "bora", "lookingAt": "book", "pose": "receiving" }
  ]
}
```

| Field | Meaning |
|---|---|
| `focus` | The main subject. A person id, an object id, a list of person and object ids, or `{ "kind": "objects-with-people", "ids": ["book", "kru-sopheak"] }`. |
| `gaze` | `rules` (default): use the adult/kids rule of thumb when it applies, otherwise look at `focus`. `focus`: everyone looks at the focus (the focus person themself still uses the special case below). |
| `objects` | Optional props. `id`, `label`, and `x` (and optional `y`) in the same percent space as placements. No new artwork is added; an object can exist only as a gaze target (the book in S6 is already in Kru’s hands). |
| `people` | Optional per-person overrides for this scene: `lookingAt` (a person id, object id, `front`, or `left`/`right`/…) and `pose`. Positions stay on `placements` (`x` left-to-right). |
| `what` / `where` / `who` | Optional notes copied from the lesson Who/What/Where line. |

A line may also set `lookingAt` and `pose`. Those override the scene for the **speaker** of that line.

`placements[].facing` remains a manual left/right flip if you need to force one.

## Resolver rules

For each person on stage:

1. **Target.** An explicit `lookingAt` on the line (if this person is speaking) or on `setup.people` wins. Else, when `gaze` is `rules` (the default) and the scene has one or more adults (`gender` male/female) and more than one child (`gender` boy/girl): children look at the nearest adult; adults look at the centre of the children. Else everyone looks at `setup.focus` (the centre of the list, if it is a group). The focus person themself looks at the current speaker if that is someone else, otherwise at `front`. If there is no target, the gaze is `front`.
2. **Desired screen direction.** Compare the person’s `x` with the target’s `x`. A small gap stays `front`; a target to the viewer’s left is `left`, to the right is `right`.
3. **Pick a file.** If the line or setup asks for a pose, filter to images that carry that tag first. A speaking line prefers a `talking` picture that keeps the same gaze; if none exists it uses the talking picture it has and logs the missing gaze. Then prefer an image whose `lookingAt` matches, or a `mirrorable` image whose gaze flips into the match. Fall back to the requested pose with any gaze, then to the idle/talking sprite already named on the actor, and log the gap.
4. **Scale.** When `placements[].scale` is omitted, the player uses `(heightCm × postureFactor) / 116 × 1.05` so people stay in proportion to Bora’s current on-stage size. An explicit `scale` still wins.

Stop, a missing catalog file, or an unknown person all leave the existing idle/speak sprites in place.

## Gaps (no new pictures were drawn)

- Almost every still faces `front` or looks `right`. There is **no native left-looking pose**. Left is only available by mirroring a right-looking (or 3/4) image.
- Yeay Chan, Malis, and Srey Mom cannot be mirrored, so they cannot look left with the current art.
- Talking APNGs were built only on the **neutral, front** body. A speaking line cannot keep a listen/wave/sampeah gaze.
- No sitting, walking, receiving, or empty-handed giving poses. Srey Mom’s “explain” picture holds up a tomato (tagged `giving`). Kru Sopheak holds a green book in every pose.
- Wave / explain / listen (and the rest of the twelve-person export, and the extra professor close-ups) are not in the runtime folder, so S1–S6 can only use neutral and talking (plus the professor panel close-ups). The catalog still records their hints.
- v1.12.0: Bopha and Dara gained `neutral-right` and `talking-right` (head, body and feet turned right; mirrorable, so they can also face left). Same canvas, feet line and visible height as their front poses (checked with `tools/measure_cast_bboxes.py`). The talking loops move the mouth only.
- The runtime professor close-up is a tighter crop than the export close-up of the same name; both are catalogued separately.
