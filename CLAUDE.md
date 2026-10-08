# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Take It Easy** is a clickable prototype of an English course for Portuguese speakers. It runs as a single-page PWA. All code lives in `prototipo/`. It uses plain browser JavaScript: no bundler, no package.json, no tests, no linter. UI copy and code comments are in Brazilian Portuguese. Keep new copy and comments in Portuguese.

## Running

Open `prototipo/index.html` directly (`file://`), or serve the folder with any static server:

```bash
python -m http.server 8080 --directory prototipo
```

- `?reset=true` in the URL (before or after the `#`) wipes progress but keeps the account and profile, then sends you to `#/inicio`. This is handled in `store.checkReset`.
- A floating dev toggle (`devToggle` in `js/app.js`) switches between the phone and desktop layouts. It also turns on "Etapas livres" (`settings.free`, on by default), which skips the gating between episode steps.
- To start completely from zero, clear the `tie.v6` localStorage key.

## AI backend (not in this repo)

`js/core/ai.js` calls `/api/health` at startup. If the endpoint answers with `ai: true`, the Mic assistant uses `/api/tutor`, `/api/report`, `/api/pronounce` and `/api/tts`, all backed by Gemini. If the server is missing or a call fails, everything falls back to **demo mode**: scripted turns from `data/maggie.js`, a regex grammar checker (`RULES` in `ai.js`) and local scoring. That server is not in this repo, and neither is `tools/tie_mic_videos.mjs`, which generates `js/data/mic-clips.js` and `assets/video/mic/*`. Every AI feature must keep working in demo mode. Demo mode is also what you get under `file://`.

## Architecture

**Global namespace and load order.** Every file is a classic `<script>` that attaches to `window.TIE`. `index.html` loads them in dependency order: core/store, then data, then core logic, then ui, then screens, with `app.js` last. Add any new file to `index.html` in the right position. Most modules read their dependencies when they load, for example `const { esc } = TIE.u`.

**State: `js/core/store.js`.**
- `TIE.store.s` holds the single persisted state object, saved to localStorage under `tie.v6` with a debounced save.
- `store.set(patch | fn)` merges a patch, saves and re-renders the whole app. Pass `{silent:true}` to skip the re-render.
- Direct mutation followed by `store.save()` is also common.
- `load()` deep-merges only `settings`, `draft`, `extras`, `maggie` and `game`. If you add a new nested key, add it to `fresh()` and, if needed, to that `deep` list.
- If you make an incompatible schema change, bump `KEY` and `v`.
- `TIE.ui` holds ephemeral UI state that is not persisted.

**Routing.** Routes are hash-based (`#/episodio/1/5`). The `ROUTES` table in `store.js` maps regexes to screen names and their params. `TIE.router.go` and `TIE.router.replace` navigate. In `app.js`, `draw()` applies the guards in this order:
1. No user → `entrar`.
2. User but no profile → `cadastro/<onbStep>`, the onboarding flow.
3. Profile present → screen.

**Screens: `js/screens/*.js`.** Each screen registers `TIE.screens[name] = { render(params, q), after?(root, params, changed, q), leave?() }`. `render` returns `{ html, tabs?, theme?, overlay?, title?, nav? }` as an HTML string. The app re-renders the whole view by setting `innerHTML` on every state change. It keeps scroll position and the focused input (by `id`) across renders, so give inputs stable `id`s. Use `after` for DOM work after render (media elements, canvases) and `leave` to stop audio and timers.

**Events are delegated, so there are no per-element listeners.**
- `data-go="route"` navigates to that route.
- `data-act="name" data-arg="…"` calls `TIE.act[name](arg, el, ev)`. Screens register their actions on `TIE.act`.
- `data-model="a.b"` binds an input two-way into `TIE.store.s`. `data-ui="x"` does the same into `TIE.ui`.
- `data-enter="name"` fires an action on Enter. `data-file="name"` fires an action on file input.

**UI helpers.**
- `TIE.C` (`ui/components.js`) holds components that return HTML strings.
- `TIE.icon(name, size)` (`ui/icons.js`) returns inline SVG icons.
- `TIE.avatar` (`ui/avatar2d.js`) renders assistant video clips in the states idle, talk, talk-happy and talk-soft.
- Always escape user or data text with `TIE.u.esc`.
- Layout is `desktop` at ≥900px (sidebar) and `mobile` below that (tab bar). Check it with `TIE.app.isDesktop()`.

**Domain logic: `js/core/`.**
- `personalize.js` is a pure function that turns an onboarding profile into ranked Extras and albums, the weekly focus, Mic missions, player defaults and the tutor context sent to the AI.
- `guide.js` works out the current episode (the first one in `TIE.data.EPS` that isn't done) and the ordered daily plan.
- `game.js` handles points, streak, daily goal, levels, badges and daily missions. Award points with `TIE.game.award(kind)`, where `kind` is a key of `POINTS`. Brand vocabulary is fixed: pontos, sequência, meta, medalha. Never use "XP" or "ofensiva".
- `review.js` runs the spaced-repetition deck. Finishing episode step 4 (Take a Look) unlocks cards for that episode's `visual` words, and finishing step 8 (Take Away) unlocks cards for its `awayExp` expressions. `sync()` runs on every render.
- `speech.js` uses browser TTS, Web Speech recognition and WAV recording. `sound.js` provides sfx and synth.

**Content: `js/data/`.**
- `curriculum.js` holds `STEPS`, the fixed 10-step episode structure (Intro → Take the Mic → e-book → Take a Look → Take It In → Take the Mic → Take a Lesson → Take Away → Take Action → Take the Mic). It also holds `EPS`, the scripted episodes. Text there was ported verbatim from the v3.2 design file, so don't reword it.
- `assistants.js` defines the five Mic characters (Maggie, Robert, Becky, Zach, Barbara) with their AI personas and voices. These are based on the character guides in `prototipo/personagens/*.pdf`.
- The remaining data files are `onboarding.js` (profile option lists), `extras.js` (Extras catalog and albums) and `maggie.js` (Mic missions and demo scripts).
- In Portuguese copy, `{N}` stands for the student's name and `{A}` / `{oA}` stand for the assistant's name or name with article ("a Maggie" / "o Robert").

**Player gating.** In `screens/player.js`, `need()` defines what must be completed in each step before the learner can move on. Progress is stored in `prog[ep]` (the furthest step reached), `stepOk`, `scores`, `exAns` and `epsDone`.

## Assets

Generated images are `.webp` files under `assets/img/gen/`. Audio and video live in `assets/audio` and `assets/video`. `prototipo/temp/` and `prototipo.zip` are scratch and source material, not part of the app.
