# Spec 03: Design system and the AI/voice contract

## A. Design system

`prototipo/css/tie.css` (433 lines) is the source of truth. `@tie/ui` copies it verbatim and only extends it.

### Fonts
| Font | Use |
|---|---|
| Archivo, italic 900 only | Display face. Used by `.num`, the logo, `.levelpill i`, `.node .ep`, `.optcard .n` and `.stat .num` |
| Figtree, variable weight 400–800 | Body text |

- The prototype loads both from Google Fonts. Production self-hosts them as woff2.
- `html{font-size:calc(16px*var(--ts))}`. `--ts` takes the values 1, 1.12 and 1.25.

### Tokens (`:root`)
| Group | Values |
|---|---|
| Navy | `--navy #0F2A55`, `--navy2 #163566`, `--navy3 #2C4674`, `--navyD #0A1E3F` |
| Blue | `--blue #2A6FF5`, `--blueD #1B52C4`, `--blueT #E8F0FE` |
| Orange | `--orange #F45A28`, `--orangeD #C2431A`, `--orangeT #FFF1EA` |
| Surfaces and lines | `--cream #F8F5EB`, `--paper #FFF`, `--line #E6E0CE`, `--line2 #D6CEB8` |
| Text | `--ink #1C1C1C`, `--muted #56607A`, `--onNavy #C9D3E6` |
| Status | `--green #1F7A4C`, `--greenT #E6F2EB`, `--red #D9645B`, `--redT #FDEDEB`, `--redL #F2C4BE`, `--gold #E9A200`, `--goldT #FFF4D6` |
| Font stacks | `--f` Figtree stack; `--fd` Archivo stack |
| Sizes | `--r 18px`, `--ts 1`, `--tab-h 72px` |
| Safe area | `--safe-b` = env(safe-area-inset-bottom) |

- `--gap` and `--wrap` are local, set inline by screens. The `.wrap` default is 720px; screens use 760, 900 or 1120.
- **Brand rule:** a learner's mistake is shown in BLUE, never red. Red is used only for wrong quiz options.

### Themes and layout
**Themes:** `.app[data-theme=cream|navy]`. Navy is used on the Mic, EXTRA, music and desafio screens.

**Layout:** `data-layout=desktop|mobile`. JS decides it: desktop when width ≥900 and phone mode is off. The CSS has only two media queries: `@media(min-width:900px)` and `prefers-reduced-motion`.

| Element | Spec |
|---|---|
| `.stage` | min-height 100dvh |
| `.app` | 100% × 100dvh |
| `.view` | flex column |
| `.scroll` | overflow-y auto |
| `.wrap` | padding 8 18 28; desktop 22 32 44 |
| `.stack` | Column flex, `--gap` (default 14) |
| `.row` | Row flex, `--gap` (default 10) |

**Side nav** (desktop):
- `.side.on-navy`, 250px wide.
- `a.nav` items: min-height 48, radius 12. Active state is a white background with navy text.
- Footer card: goal, level and streak.

**Tab bar** (mobile):
- `.tabbar`, 5 columns.
- The `.tab .ico` pill is 52×30 and turns orangeT/orange when on.
- Tabs: Hoje, Trilha, EXTRA, Mic, Revisão.

**Topbar:**
- `.topbar`: min-height 60.
- `.iconbtn`: 44px circle.
- `.avatarbtn`: 42px.

### Components (all in `tie.css`)
| Component | Spec |
|---|---|
| `.btn` | `--bg`/`--fg`, min-height 52, radius 14, weight 800. Variants: block, compact, navy, blue, green, light, ghost, link, disabled `#C9C2AE` |
| `.input` | 52px, radius 14, focus = blue ring |
| `.chip` | 44px pill; `.on` = navy with an orange check |
| `.pill` | Variants: navy, or, bl, gr, gold, lvl, saypill |
| `.levelpill` | — |
| `.toggle` | 50×30, green when on |
| `.seg` | — |
| `.bar` | — |
| `.ring` | 64px SVG; `.lg` 96 |
| `.segs` | 10 bars, with a sep before steps 4 and 10 |
| `.card` | White, radius 18, 1.5px line border. Variants: navy, soft, or, bl, gr, hi, dash, paper |
| `.now-card` | Gradient 160deg `#17396F`→navy→navyD, radius 22 |

Gamification: `.gamebar` (3 tiles), `.medal`, `.badges`.

Trail: `.trail`, `.node` (dot 26px; current dot pulses), `.body`, `.locked`, `.aside`.

Wizard: `.wiz-head`, `.wiz-foot`, `.optcard`, `.fmt` (3/4 image tile), `.days`, `.vu`.

EXTRA:
- `.cover` (150px, art 2/3), `.rail`.
- `.flow` 3D coverflow:
  - Height 340, desktop 420. Items 180, desktop 230.
  - perspective 900, translateZ(−160·d), rotateY(−28·d), scale 1−.08d.
- `.hero-extra`, `.shelf-tabs`.
- `.scene` (16/9, Ken Burns) with subtitle boxes.

Karaoke: `.line`/`.lyric` (orange left bar when on), `.gap`, `.quiz-field`.

Player:
- `.player-head`, `.player-dock`, `.player-foot`.
- `.steprow`, `.dialog-line`.
- `.opt` (right = green, wrong = red), `.pillopt`, `.waves`, `.flash`, `.note`.

Mic:
- `.live`.
- `.avatar-stage` (aspect 4/3.2, `#E6EAF2` background) with `.status`, `.eq` and `.caption`.
- `.av2d video` (object-position center 30%).
- `.modes`/`.mode`, `.transcript`.
- Bubbles: `.bub.her` is white, `.bub.me` is blue.
- `.fbrow`/`.fbchip` (certo greenT, ajuste blueT, natural cream).
- `.dock` (navyD) with `.help`, `.say` and `.mic` (64px orange, ripple while recording).
- Also: `.thinking`, `.cmp`, `.stat`, `.assist`, `.av-ini`, `.demo-badge`.

Auth: `.auth .hero` (min-height 250, navy image + gradient), `.formcard`, `.divider`.

Overlays: `.overlay`/`.scrim`/`.sheet` (cream, top radius 24, `.grab` handle), `.toast` (navy, bottom), `.pts-toast` (gold, top), `.confetti` (40 pieces).

### Keyframes
`ptsUp`, `pulse`, `rec`, `kb`, `talkbob`, `blink`, `eq`, `dot`, `wave`, `sheet`, `fade`, `enter`, `pop`, `fall`.

- `enter` (.3s, `cubic-bezier(.2,.8,.2,1)`) is applied to `.view` on every route change.
- Reduced motion cuts all animation.

### Accessibility
- `:focus-visible` = 3px blue outline.
- Touch targets are ≥44px.
- ARIA: `role=switch`, `aria-pressed`, `radiogroup`, `aria-label` on icon buttons.

### Icons
`icons.js` returns 24×24 SVGs with stroke 2.2 and round caps.

Names: home, trail, tv, review, profile, play, pause, stop, mic, back, next, close, check, down, plus, speaker, list, lock, flag, chat, wave, music, plane, brief, ear, book, cards, pen, clock, bell, heart, game, eye, eyeoff, repeat, cc, send, bulb, trophy, download, phone, desktop, power, logout, star, fire, coin, target, sparkle, google, apple.

### Logo
- `.logo .wm` (Archivo 900 italic) reads "TAKE IT" + `.el` + "EASY".
- `.el` is three skewed bars, skewX(−22deg):
  - Each bar is .9em × .22em.
  - Colors top to bottom: blue, orange, navy. The navy bar turns white on dark backgrounds.
- Optional `.desc`: "INGLÊS PARA QUEM FALA PORTUGUÊS".
- App icon: `assets/svg/icon.svg`, a 64×64 navy rounded square with the three bars.

### Manifest
- name "Take It Easy · Inglês para quem fala português", short_name "Take It Easy".
- standalone, background `#F8F5EB`, theme `#0F2A55`, lang pt-BR.

## B. AI and voice contract (keep identical)

### `GET /api/health`
Returns `{ai:boolean, model?:string}`.

### `POST /api/tutor`
**Request (prototype client):**
```
{mode, mission, extraId, ctx, persona, assistantName,
 history: [{who, en}] (last 12),
 text, turn, script: [en]}
```
**PROD request:** `{session_id, text, turn}`. Persona, ctx, history and script are all built on the server.

**Response:**
```
{reply_en, reply_pt,
 feedback: {status: 'certo'|'ajuste'|'natural', original, corrected, explain_pt, cat, tip_pt?},
 pron_watch: [{word, tip_pt}],
 new_words: [{en, pt}],
 mood: 'happy'|'curious'|'encouraging'|'thinking'|'correcting',
 end, hint_en, hint_pt, source: 'ia'|'demo'}
```

Mood selects the avatar clip: encouraging → talk-happy, thinking/correcting → talk-soft, anything else → talk.

### `POST /api/report`
**Response:**
```
{summary_pt, strengths: [],
 fixes: [{said, better, why_pt, cat}],
 pron: [{word, tip_pt}],
 words: [{en, pt}],
 next_goal_pt, source}
```

### `POST /api/pronounce`
**Request:** `{audio: <base64 WAV, 16 kHz mono PCM16, no data: prefix>, target}`

**Response:** `{score: 0..10, heard, issues: [{word, issue_pt?, tip_pt}], praise_pt, source}`

A score of 8 or more counts as good.

### `POST /api/tts`
**Request:** `{text, gender, voice}`. **Response:** audio bytes, decoded with `decodeAudioData`. A failure falls back to browser TTS.

### Recording (`speech.record`)
1. `getUserMedia` with echoCancellation and noiseSuppression.
2. `MediaRecorder`, with level meter via `AnalyserNode` (fft 1024, `peak*1.6`).
3. Resample with `OfflineAudioContext` to 16 kHz mono and write a hand-made 44-byte WAV.
4. Encode as base64 and return `{b64, secs}`.

### Listening (`speech.listen`)
- `SpeechRecognition` with en-US and interim results.
- A `not-allowed` error shows a toast.

### Browser TTS (`speech.say`)
- Voices are filtered to en-US.
- Female preference: Aria / Jenny / Ava / Emma / Michelle Natural, then Google US English / Samantha / Zira.
- Male preference: Andrew / Guy / Christopher / Brian Natural, then Google US English Male / Guy / David.
- Rate = .95 × opt × voice. Pitch comes from the assistant (.95 male, 1.05 female).
- Zach prefers the "Ana" voice (pitch .94, rate .95).
- A watchdog stops speech after `max(2500, len/13.5s + 2.5s)`.
- Mouth sync uses visemes for the 2D avatar. The video avatar only switches on talking and mood.

### Assistant voices (prototype)
| Assistant | Pitch / rate |
|---|---|
| Maggie | 1.05 / 1 |
| Robert | .9 / .95 |
| Becky | 1.12 / 1.05 |
| Zach | 1.3 / 1.05 |
| Barbara | .95 / .95 |

### Help buttons
- "Slowly, please." repeats the line at rate .7.
- "Sorry?" and "Again, please." repeat it at .85.

### Avatar (`avatar2d`)
- One muted, looping, `playsinline` `<video>` per clip.
- Clips cross-fade over .25s. The idle clip shows a poster.
- With no clips, initials are shown instead.
- API: `mount(el, k)` → `{mouth, mood, talking, listening, destroy}`.

### Demo fallback (must stay)
**`analyze`:**
- 15 regex RULES, each with a category.
- A Portuguese word → `natural` ("Português no meio").
- 2 words or fewer → `natural` ("Resposta curta").
- Anything else → `certo` with a PRAISE line.

**`recast`:** "Oh, you're …".

**`pronWatch`:**
- At most 2 words per answer.
- Tips cover: h, s+consonant, th, final b/d/g/k/p.

**`hintFor`:** a regex table that maps question patterns to (EN, PT) hint pairs.

**`demoReply`:**
- Next scripted turn. The script depends on the mode:
  - missao → MISSIONS turns;
  - extra → series turns, with line 0 rewritten for the extra title;
  - livre → OPENERS[first format] + FOLLOW.
- Waits 700–1200ms before replying.
- Ends at script end or after turn 9.

**`demoReport`:**
- Fixes come from `ajuste` turns.
- Strengths: correct turns, one 6-word sentence, and asking a question back.
- Up to 4 pronunciation items and up to 8 words.
- `next_goal_pt` comes from the top fix category.

**`demoPronounce`:**
- Word overlap: `score = max(4, round(hits/total*10))`, or 7 if nothing was heard.
- `praise_pt` tiers: 9 or more, 7 or more, otherwise.

### Sessions
- Each tutor turn awards `maggie_turn` and counts 20s toward the daily `maggieSec`.
- A pronunciation try counts 15s.
- `finish()`:
  - `secs` = wall clock time;
  - `secLeft` is reduced by `secs`;
  - awards `maggie_session` if the user spoke 2 or more times;
  - keeps at most 12 sessions.

### Sound (`sound.js`)
- One shared `AudioContext` with master gain .9.

**sfx** (synthesized oscillators):
| Name | Sound |
|---|---|
| tick | 1800Hz, 30ms, on every click |
| ok | 660 → 990 triangle |
| soft | 520 → 440 |
| points | 880, 1175, 1480 arpeggio |
| level | C, E, G, C |
| rec | 880 |
| done | A, C#, E |

**`synth.play({bpm, key})`:** I–V–vi–IV backing track (kick, snare/hat, saw bass, square arpeggio, pads, 2.2k lowpass) for songs without an mp3.
