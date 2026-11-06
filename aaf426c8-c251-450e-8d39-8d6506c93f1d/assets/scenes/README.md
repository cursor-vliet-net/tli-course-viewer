# Scene storyboards (JSON)

These files power the in-page scene player. They are **not** compiled into `data.js`.
Edit a JSON file (or swap a PNG under `media/`) and reload the viewer — no Markdown rebuild needed
for scene changes. Markdown only points at a file:

```html
<div class="tli-scene-player" data-scene="scenes/s001.json"></div>
```

Paths inside JSON are relative to `viewer/assets/`.

## Schema

```json
{
  "id": "S001",
  "title": "Good morning, Yeay",
  "defaultDurationMs": 3500,
  "background": "media/backgrounds/home-morning.png",
  "actors": {
    "bora": {
      "name": "Bora",
      "kind": "character",
      "sprites": {
        "idle": "media/characters/bora-idle.png",
        "speak": "media/characters/bora-speak.png"
      }
    },
    "cat": {
      "name": "cat",
      "kind": "animal",
      "sprites": { "idle": "media/animals/cat-idle.png" }
    }
  },
  "scenes": [
    {
      "id": "1",
      "background": "media/backgrounds/home-morning.png",
      "placements": [
        { "id": "yeay-chan", "sprite": "speak", "x": 28, "y": 92 },
        { "id": "bora", "sprite": "idle", "x": 55, "y": 94, "scale": 0.95 }
      ],
      "speaker": "yeay-chan",
      "text": "Good morning, Bora!",
      "textKm": "អរុណសួស្តី បូរ៉ា!",
      "audio": null,
      "durationMs": 3500,
      "delayMs": 0
    }
  ]
}
```

### Timing (first-class)

| Field | Where | Meaning |
|---|---|---|
| `defaultDurationMs` | conversation | Fallback length of a scene before auto-advance. |
| `durationMs` | scene | How long this line/scene plays before auto-advance. Honoured even when audio is on; if omitted later and `audio` exists, the player may use the audio length — for now audio is bypassed, so always set milliseconds. |
| `delayMs` | scene (optional) | Pause before the line's timer counts as playing; omit when unused. |

The progress bar is **elapsed time through the whole conversation** (sum of each scene's `delayMs + durationMs`), not only the scene index. Scrubbing jumps to the scene at that time. Pause freezes the current scene timer; Play resumes it.

### Actors and sprites

- `kind` is `"character"` or `"animal"` (renderer treats both the same; animals can be added later).
- `sprites` maps a sprite key (`idle`, `speak`, …) to an image path.
- Each placement sets `id`, `sprite`, `x`/`y` (percent of the stage; anchor is bottom-centre), optional `scale`, optional `facing` (`"left"` / `"right"`).
- `speaker` is the actor id whose line is shown; click that actor to repeat the line (subtitles + audio if enabled).

### Subtitles

- `text` = English, `textKm` = Khmer. Viewer toggles show either, both, or neither.
- Khmer in these files is draft Grade-1 wording and must be verified by a native speaker (open item 21).

### Audio

Leave `"audio": null` for now. The viewer **Audio** setting defaults to off (bypass). When on, a non-null `audio` URL is played; missing files still show subtitles only.
