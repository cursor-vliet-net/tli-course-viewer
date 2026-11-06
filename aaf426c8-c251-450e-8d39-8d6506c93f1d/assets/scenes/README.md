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
        { "id": "yeay-chan", "sprite": "idle", "x": 28, "y": 92 },
        { "id": "bora", "sprite": "idle", "x": 55, "y": 94 }
      ],
      "durationMs": 6200,
      "lines": [
        {
          "speaker": "yeay-chan",
          "text": "Good morning, Bora!",
          "translations": { "km": "អរុណសួស្តី បូរ៉ា!" },
          "audio": null,
          "durationMs": 3200,
          "atMs": 0
        },
        {
          "speaker": "bora",
          "text": "Good morning, Yeay!",
          "translations": { "km": "អរុណសួស្តី យាយ!" },
          "audio": null,
          "durationMs": 3000,
          "atMs": 3200
        }
      ]
    }
  ]
}
```

### Lines (multi-speaker scenes)

Each scene has a `lines` array. Several characters can speak in one scene; the learner clicks a character **while paused** to replay **that** character’s line (subtitles, and audio if Audio is on). Clicks while playing are ignored.

| Field | Meaning |
|---|---|
| `speaker` | Actor id (must appear in `placements` to be clickable). |
| `text` | Source English line. |
| `translations` | Map by language code (`km`, …). `translations.en` may override `text`. |
| `audio` | Optional URL/file. When set and Audio is on, the file plays. When null/omitted, English `text` uses browser `speechSynthesis`. Ignored while Audio is bypassed. Never TTS for Khmer. |
| `durationMs` | How long this line lasts (fallback: conversation `defaultDurationMs`). |
| `atMs` | Optional start offset within the scene. If omitted, lines run in order (each after the previous duration). |

Scene-level `durationMs`, if omitted, is the end of the last line (`max(atMs + durationMs)`). Scene-level `delayMs` (optional) pauses before the scene’s timer.

Clicking a character with no line in the current scene does nothing. If they have several lines, the player replays the most recently spoken one, or else their last listed line.

### Timing and playback

- Conversation `defaultDurationMs` and per-line / per-scene durations pace each scene. **Auto** (default **off**) advances to the next scene when on; at story end it resets to scene 1 paused.
- With Auto off, Play finishes the current scene then pauses; Next/Prev land paused. Character clicks only work while paused.
- Playback speed (0.25x–2x) scales wall-clock wait as `time / speed` and TTS rate.
- Progress bar = elapsed time through the whole conversation (sum of scene durations + delays).

### Actors and sprites

- `kind` is `"character"` or `"animal"` (same renderer).
- `sprites` maps keys (`idle`, `speak`, …) to image paths.
- Placements: `id`, `sprite`, `x`/`y` (percent; bottom-centre anchor), optional `scale` / `facing`.
- While a line plays, that speaker is highlighted (speak sprite when available).

### Subtitles and audio

- Captions sit **below** the 16:9 stage (not over the picture). EN and KM toggles are independent (default both on).
- Audio setting defaults **on**. Master switch: off = subtitles only (no file, no TTS). When on: if `audio` is a URL/file, play that file; else speak English `text` with browser `speechSynthesis` (English voice when available). Khmer has no TTS for now. Leave `"audio": null` until files exist — TTS covers English in the meantime.
- Khmer is draft Grade-1 wording pending native-speaker check (open item 21).
