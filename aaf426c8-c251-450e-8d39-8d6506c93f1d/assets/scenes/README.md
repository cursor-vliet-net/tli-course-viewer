# Scene storyboards (JSON)

These files power the in-page scene player. They are **not** compiled into `data.js`.
Edit a JSON file (or swap a sprite under `media/`) and reload the viewer — no Markdown rebuild needed
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
        "speak": "media/characters/bora-speak.gif"
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

Each scene has a `lines` array. Several characters can speak in one scene; while **paused**, only characters that have a line in the current scene are clickable (pointer cursor) to replay **that** line (subtitles, and audio if Audio is on). Other characters keep the default cursor. While playing or on the big-play overlay, no character is clickable.

| Field | Meaning |
|---|---|
| `speaker` | Actor id (must appear in `placements` to be clickable). |
| `text` | Source English line. |
| `translations` | Map by language code (`km`, …). `translations.en` may override `text`. |
| `audio` | Optional URL/file. When set and Audio is on, the file plays. When null/omitted, English `text` uses browser `speechSynthesis`. Ignored while Audio is bypassed. Never TTS for Khmer. |
| `durationMs` | How long this line lasts (fallback: conversation `defaultDurationMs`). |
| `atMs` | Optional start offset within the scene. If omitted, lines run in order (each after the previous duration). |

Scene-level `durationMs`, if omitted, is the end of the last line (`max(atMs + durationMs)`). Scene-level `delayMs` (optional) pauses before the scene’s timer.

Characters with no line in the current scene are not clickable. If they have several lines, the player replays the most recently spoken one, or else their last listed line.

### Timing and playback

- Conversation `defaultDurationMs` and per-line / per-scene durations pace each scene. **Autoplay** (default **off**, icon with Prev/Play/Next/Replay) advances to the next scene when on; at story end it resets to scene 1 paused.
- With Auto off, Play finishes the current scene then pauses; Next/Prev land paused. Character clicks only work while paused.
- Playback speed (0.25x–2x) scales wall-clock wait as `time / speed` and TTS rate.
- Progress bar = elapsed time through the whole conversation (sum of scene durations + delays).

### Professor explanation (optional)

A story with no `professor` and no `explanations` plays exactly as before. Do not add an explanation to every scene. The same rules apply to every story. Nothing here is special to S001.

He can clarify only something that has already been said or done. Each explanation names one scope:

- `"scope": "scene"` — the whole current scene.
- `"scope": "line"` plus `"line": 0` — one line in that scene, by index. A scene scope must not also name a line.

`leadMs` is how long before that scope ends the corner icon may fade in. `windowMs` is how long that explanation stays eligible after the scope ends. Either value may sit on the explanation or, as a default, on `professor`. The icon fades in at the start of the lead. Once it is actually on screen it stays at least **7000 milliseconds of real time**, not story time and not shortened by playback speed. If that explanation's window ends and no other explanation is eligible, the icon then fades out. If another explanation becomes eligible while the icon is up, the same icon stays (no fade out and back in, and the 7000 ms clock does not restart) and a click opens the newer one. The click is never a dead button: during the extra time it still opens the latest explanation whose words are already allowed. Seek, Previous, Next, Replay, and leaving the lesson drop the icon at once. The story moving itself to the next scene does not. That automatic step keeps the same icon until the seven real seconds are up.

People stand on the neutral still until Play. The talking picture is only for the person whose line is actually playing. Pause, stop, a finished scene, and a seek while stopped return everyone to the neutral still. The professor's close-up follows the same rule on his own Play button, separate from the story. The player preloads every picture named by the six storyboards and by the lesson pages (stills, talking loops, the professor, backgrounds, and the other lesson images). It does not fetch older design files that those pages do not name. A missing file does not stop the player. If the browser asks for less motion, the still pose is shown and the loop is not.

The panel cannot open during the lead. A click there only remembers the request. The panel opens, still silent, once the scene or line has finished and the window is still open. That is what keeps a slightly early icon from teaching the line that is still being said. After the window, the icon is gone. Closing the panel does not bring it back unless the clock is still inside the window. Seek, Previous, Next, Replay, and a scene change recompute the window and drop a stale icon. An explanation that was already open closes on those moves. It never starts by itself, and it never speaks until its own Play.

The build (`scene_schema.py`, used by `check_course.py` and `build_viewer.py`) and the player (`TLIScenePlayer.validateStory`) both reject a missing scope, a bad line index, a lead longer than the scope, a window that is not positive, overlapping windows in one scene, and the old `cueMs` / explanation `atMs` clock. They do not read the sentences. The author still has to check that the words only refer to what that scope has already presented.

```json
"professor": {
  "id": "professor-mordechai",
  "name": "Professor Mordechai",
  "leadMs": 1200,
  "windowMs": 2800,
  "minVisibleMs": 7000,
  "icon": "media/characters/year-01/professor-icon.svg",
  "avatar": "media/characters/year-01/professor-closeup-neutral.png",
  "sprites": {
    "idle": "media/characters/year-01/professor-closeup-neutral.png",
    "talk": "media/characters/year-01/professor-closeup-talk.apng",
    "speakStill": "media/characters/year-01/professor-closeup-neutral.png"
  },
  "lipSync": false
}
```

`icon` is the small face on the availability button. `sprites` are the waist-up picture in the panel. They are not the same file. `lipSync` must be false: the talking picture loops and is not matched to the sound. With reduced motion the panel keeps `speakStill`.

On a scene:

```json
"explanations": [
  {
    "id": "s001.greet-without-name",
    "scope": "scene",
    "leadMs": 1200,
    "windowMs": 2800,
    "durationMs": 12000,
    "review": { "km": "draft", "cultural": "pending-khmer-native-review" },
    "text": { "en": "…", "km": "…" },
    "subtitles": {
      "en": [{ "atMs": 0, "durationMs": 4000, "text": "…" }],
      "km": [{ "atMs": 0, "durationMs": 4000, "text": "…" }]
    },
    "audio": { "en": null, "km": null }
  }
]
```

S001 scene 1 uses a scene scope. Its words are about Yeay saying good morning and then the name. They do not explain the later question from Kru Sopheak. That question has its own explanation after Bora has answered. The icon may show during the last 1200 ms of the reply. The panel waits until the scene has finished. That wording check is manual. The schema check only proves the clock.

The panel has previous, play/pause, and next for his own spoken parts, plus a part counter such as 1 / 3. It has no timeline. Clicking his icon opens the panel and starts the first part. Close stops him. The story stays paused. The language control is one EN/KH selector at the top left, and Close is at the top right. The selector is hidden unless that explanation has a recorded Khmer file. With no Khmer recording the panel speaks English only (the English file, or English speech synthesis). It never uses a Khmer browser voice. A Khmer recording that fails to play falls back to English and hides the selector. The story's EN / ខ្មែរ switches do not change this. Subtitles follow the professor language that is actually playing. Each spoken line runs until the voice or the file finishes. The subtitle clock and the icon timer do not cut it off. Automatic scene advance does not close an explanation that is already open. Seek, Previous, Next, Replay, and Close do.

Opening or playing the professor pauses the story and stops its audio. Playing or seeking the story pauses the professor. Closing the panel fades it out and does not start the story.

### Actors and sprites

- `kind` is `"character"` or `"animal"` (same renderer).
- `sprites` maps keys (`idle`, `speak`, …) to image paths. Paths may be `.gif`, `.svg`, `.webp`, `.png`, or `.apng` — the player uses a plain `<img src>`; the browser plays animated formats natively. There is no extension filter in the player.
- Typical cast: `idle` is a still PNG; `speak` is a short looping talking GIF (idle mouth + open mouth). Keep the matching `*-speak.png` next to the GIF for `prefers-reduced-motion` (the player swaps `.gif`/`.webp`/`.apng` → `.png` when reduced motion is set). Optional `speakStill` overrides that still path.
- Placements: `id`, `sprite`, `x`/`y` (percent; bottom-centre anchor), optional `scale` / `facing`.
- While a line plays (or that character is the current speaker while paused), that speaker uses the speak sprite; others use idle. Do not CSS-animate the `img` in a way that fights `.face-left img { transform: scaleX(-1) }`.
- Year-01 people use `media/characters/year-01/<id>-neutral.png` for idle and `<id>-talking.apng` while speaking. The APNG loops. It is not matched to the audio. `speakStill` is the neutral pose for reduced motion. `lipSync` is false.

### Subtitles and audio

- Captions sit **below** the 16:9 stage (not over the picture). EN and KM toggles are independent (default both on).
- Audio setting defaults **on**. Master switch: off = subtitles only (no file, no TTS). When on: if `audio` is a URL/file, play that file; else speak English `text` with browser `speechSynthesis` (English voice when available). Khmer has no TTS for now. Leave `"audio": null` until files exist — TTS covers English in the meantime.
- Optional `gender` on an actor is `female`, `male`, `girl`, or `boy`. On `professor` it is `female` or `male` only. Omit it when the cast record does not say. The browser has no gender field on a voice. A hint is used only when an installed English voice is a known female or male name (for example Microsoft Zira or Microsoft David on Windows) or its name says Female or Male. Otherwise the line uses a plain English voice. The same character keeps the same voice. Boy and girl fall back to male and female voices and raise TTS pitch (boy ~1.6, girl ~1.9) when no child-labeled voice is installed; a voice whose name contains boy/girl/child is preferred and kept at pitch 1. When a matching gendered voice is missing (typical on Android), pitches are male ~0.7, female ~1.25, boy ~1.6, girl ~1.9. Recorded audio files are not pitch-shifted. A recording still wins over speech synthesis. The professor is never spoken with a Khmer browser voice.
- Khmer is draft Grade-1 wording pending native-speaker check (open item 21).
