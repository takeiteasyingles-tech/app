# Spec 01: Student app feature inventory (from `prototipo/`)

Everything here describes the prototype. The new app must reproduce it 1:1: same routes, same DOM/classes, same copy (pt-BR), same behaviour. The exceptions are the items marked **PROD**, where production must differ.

## 0. App shell (`js/app.js`, `js/ui/components.js`)

### Route guards (`draw()`)
1. No user → `entrar`.
2. User but no profile → `cadastro/<onbStep>`.
3. `raiz`, or `entrar`/`cadastro` while a profile exists → `inicio`.
4. Unknown route → `inicio`.

### Every render
- Calls `review.sync()`, which toasts "N cartões novos na Revisão" when it adds cards.
- Keeps the scroll position and the focused input across re-renders.

### Layout
| | Desktop (≥900px and not `settings.phone`) | Mobile |
|---|---|---|
| Navigation | Sidebar `C.side` | Tabbar `C.tabbar` |
| Items | Hoje, Trilha, EXTRA, Mic, Você, Revisão (due badge), Conquistas | Hoje, Trilha, EXTRA, Mic, Revisão |
| Extra | Sidebar footer card: goal bar, level pill, streak | Profile is reached through `C.avatarBtn` |

### Dev-only items
- The dev toggle (`setFree` = "Etapas livres" bypass, `setPhone`) is dev-only.
- **PROD:** do not ship the toggle. The free-steps bypass sits behind the feature flag `dev.free_steps`.

### Effects
- `app.toast`.
- `app.points(n)`: "+n pontos" toast + sfx + refresh of the gamebar.
- `app.confetti`, gated by `settings.fx`.

### Components
logo, btn, chip, toggle, topbar, userPic (photo or `avatar/user-N.webp`), assistPicker, avatarBtn, demoBadge ("IA ligada" / "Modo demo"), segs (10-step bar), ring, gamebar (streak / points / today goal), levelpill, cover (level pill, "Sexta" lock overlay, why line), flow + flowMount (3D coverflow, auto-advance 3.8s, drag, dots), missions (+15 pill), stage (avatar stage with bg, status pill, EQ bars, caption).

### Global actions
- `say(text)`: TTS.
- `sayMark(text, el)`: TTS, then marks the button as heard (turns blue; ephemeral).

## 1. `entrar` (`#/entrar`): login

### Layout
- Hero with `bg/login.webp` and the tagline "Você não faz lições. Você acompanha uma história."
- E-mail field; Senha field with eye toggle (`loginShow`); "Esqueci a senha" (`forgot`).
- Entrar button; Google/Apple buttons; "Criar conta grátis" → `cadastro/1`; "Entrar na conta demo (Ana)".
- Footer: "Protótipo: nenhum dado sai do seu navegador."

### Prototype behaviour
- `login` only validates the email regex and pass ≥6, sets the user plus the DEMO profile, and goes to `inicio`.
- `social` is simulated.
- `demoLogin` uses `TIE.DEMO_PROFILE` (Ana).

### PROD
- Real auth: email + password + Turnstile.
- **Remove** the Google/Apple buttons.
- Remove the demo account entry, or replace it with nothing.
- "Esqueci a senha" shows a toast telling the user to contact support (admin issues reset links). Optional later: email reset.
- Replace the footer line with links to the privacy policy and terms.

## 2. `cadastro` (`#/cadastro/:step`): onboarding, 7 steps from `ONB.STEPS`

### Wizard chrome
- Header: "Etapa n de 7 · title" with segment dots.
- Step 1 has X → `entrar`; later steps have back (`onbBack`).
- Footer:
  - Continuar (`onbNext`), disabled unless `valid(n)`.
  - Pular (`onbSkip`) on steps 2–5 (`skip:true`).
  - Last step: "Começar o curso" if the voice test is done, else "Pular por enquanto" (`onbFinish`).
- Answers live in `draft.*`.

### Step 1, `conta`
| Field | Validation |
|---|---|
| Nome completo | 2+ words |
| Como quer ser chamado | 2+ chars, auto from first name |
| Data de nascimento | age 5–110, gives an age band (-18, 18-24, 25-34, 35-44, 45-59, 60+) |
| E-mail | regex |
| Senha | 6+ chars, eye toggle `onbShow` |

- Copy: "Ao continuar você aceita os Termos de Uso e a Política de Privacidade. O primeiro episódio é grátis para sempre."
- **PROD:** step 1 creates the account (signup + Turnstile). Store terms acceptance (timestamp + version). Never persist the password client-side.

### Step 2, `objetivo`
- Optcards from `ONB.GOALS` (8, each with icon, title, sub).
- Max 3 (`onbGoal`); counter "n de 3 escolhidos".

### Step 3, `gostos`
- Format grid `ONB.FORMATS` (9, with images; `onbFormat`). Deselecting a format prunes its genres.
- One genre chip block per selected format, from `ONB.GENRES[format]` (`onbGenre`).
- "E fora da tela?": theme chips `ONB.THEMES` (`onbTheme`).
- Requires ≥1 format.

### Step 4, `trava`
- `ONB.DIFFS` (8, `onbDiff`).
- If more than one is picked, "Qual trava mais?" appears (single select, `onbMain` → `mainDiff`), labelled "Vira o foco da semana".

### Step 5, `estilo`
- `STYLES` (6, `onbStyle`).
- `COMPANY` single select (`onbCompany`).
- `FEEDBACK` single select (`onbFeedback`).

### Step 6, `ritmo`
- Weekday buttons D S T Q Q S S, values 0–6 (`onbDay`). Label: ritmo da série / tranquilo / leve.
- Minutes 20 / 30 / 40 / 50 (`onbMin`).
- Reminders: time inputs (`draft.reminders.i`), ≤5. `onbRemAdd` suggests an unused time from 07:00, 12:30, 20:00…; `onbRemDel` removes.

### Step 7, `voz` (voice test)
- Avatar stage (`TIE.avatar.mount`). Caption "Hi, {name}. Can you say this for me?". Target phrase "Hi, I'm {name}." plus an H tip. 18-bar VU meter.
- `onbHear`: TTS of the target.
- `onbRecord`: `speech.record` (maxMs 5000, level meter) in parallel with Web Speech `listen`; auto-stops at 4.2s; then `ai.pronounce(b64, target, heard)` → `draft.voice = {score, praise_pt, issues, heard}`.
- Shows score /10 and feedback.
- Privacy copy: the audio is not kept.

### `onbFinish`
- Builds the profile from the draft: `level:'zero'`, `occup`/`area` empty, sorted reminders.
- Sets `settings.slow` from `personalize.defaults.speed`.
- `game.touch()`, confetti, toast "Bem-vindo a Beacon", → `inicio`.

## 3. `inicio` (`#/inicio`): "Hoje" (navigation only)

### Sections, in order
1. Greeting "Oi, {name}.", level pill, "Temporada X · CEFR", avatar button.
2. Now-card for the current course step, from `guide.current()`, the first unfinished EPS entry:
   - number, title, ebook, segs, "n/10", step name;
   - CTA "Começar o episódio N" / "Continuar em X" / "Seguir para a próxima etapa" → `episodio/N`.
3. Plano de hoje (`guide.plan()`), with a goal ring %:
   - episode step;
   - "Rebobinar N cartões", if any cards are due;
   - Mic mission;
   - Extra, if minutes ≥20.

   Tasks are ordered by styles.
4. Missões do dia.
5. "EXTRA pra você": top 4 (mobile) or 6 (desktop) unlocked covers.
6. Mic card: first personalized mission → `maggie?modo=missao&m=k`, with minutes left this month.
7. Foco da semana (FOCUS by `mainDiff`).
8. Week dots + reminder hours.

### Layout
- **Mobile:** topbar (logo + demoBadge), single column with the gamebar first.
- **Desktop:** 2 columns.
  - Left: course, plan, extras.
  - Right: gamebar, missions, Mic, focus, week.

## 4. `trilha` (`#/trilha`)

### Header
- Season 1 "Arrival", A1, progress bar "n de 20", synopsis.
- `<details>` listing 8 seasons: Arrival, Settling In, Behind the Counter, First Customers, The Deal, Under Pressure, Going Big, Full Circle.

### Trail
- 10 e-book chapters × 2 episodes, titles from `TITLES[20]`.
- Episode nodes are done / now / locked.
  - Only done and current nodes are clickable.
  - Unscripted episodes before the current one show "Em produção".
- After each e-book: an "Extras e teste do e-book N" node.
  - For e-book 1 it unlocks once episodes 1 and 2 are done → `/ebook/1`.
  - Shows `testScore`/20.

## 5. `ebook` (`#/ebook/1`) and `ebookx` (`#/ebook/1/:part`)

### `ebook`
- Scope card.
- Links to episodes 1 and 2.
- 4 extras cards (`EXTRAS_EB`): Take Five, Take the Lead, Take it for Real, Take It Out ("Em produção").
- Test card: 20 Qs, 70% cutoff, "recomenda, não bloqueia", last score.
- Teaser for e-book 2.

### `five`
`TIE.blocks(FIVE)`, bilingual culture pages.

### `real`
Book-vs-street cards + accent note.

### `lead`
- Scripted branching chat with Margaret (`LEAD`: 5 turns, 2–3 options each).
- `leadSend(i)`:
  - a wrong option (`fix`) adds a correction;
  - a correct one awards `maggie_turn`;
  - typing pause 900ms, then TTS.
- `leadHelp(en)`: HELP phrases; Margaret repeats at 0.75.
- `leadReset`.
- End card: ≤3 fixes + CTA "Fazer ao vivo com a Maggie" → `maggie?modo=missao&m=gente`.
- State is ephemeral.

### `teste`
- 20 Qs in 4 parts:
  - A: multiple choice;
  - B: fill-in;
  - C: translate (free text, `norm()` vs `acc[]`);
  - D: pronunciation (Q20 has an audio button that says "hi").
- Sticky progress bar.
- `testPick("n:i")`; text answers via `data-model="testAns.n"`.
- `testSubmit` scores; 14+ awards `test_pass`. `testRedo` clears.
- Result: score and %, pass/fail copy, wrong-answer cards ("VOCÊ" vs "CERTO" + "Revisar: …" → `episodio/ep/step`, default step 7).
- **PROD:** grading happens on the server.

## 6. `player` (`#/episodio/:ep/:step?`): 10 steps

### Routing
- No step → `prog` (or 1 if `prog`≥10).
- step > `prog` → redirect to `prog`.
- Unknown episode → `trilha`.

### Head
- `plClose` → inicio.
- "Episódio N · etapa x de 10", map button (`plSheet`), segs, step name EN/PT.

### Foot
- Prev (`plPrev`).
- Next (`plNext`): disabled and showing the `need()` message while gated. Kicker "+10", or "+40" on the last step.

### Step list (map)
- **Mobile:** bottom sheet.
- **Desktop:** persistent 300px left aside: "Voltar para Hoje", scope, `stepList` (`plGo(n)` to any reached step).

### Gating
- `gate()` = '' if `settings.free`, else `need()`.
- Step 3 always requires `ebooks[ebook]`.
- A step is also unlocked by `epsDone`, `prog > step` or `stepOk`.

### Progress and points
- `setStep(n, award)`: awards `step` (+10) when advancing past `prog`.
- `plNext` on step 10: `prog=10`, `epsDone`, `episode` (+40), confetti → `concluido/ep`.

### Steps
1. **Intro.** Navy card with title and synopsis, `plPlay`.
   - With `introAudio`: Audio element + progress/time; `ended` → `mark(1)`.
   - Without it: synth jingle (bpm 112), 15s, then mark.
   - Gate: "Ouça a abertura até o fim".
2. **Take the Mic (song, 1st pass).** Shared `song()` renderer.
   - Fixed dock: title, translation toggle (`plTrans`), play, progress.
   - Lyrics with the current line highlighted, auto-scrolled to center.
   - With `songAudio`: line = `currentTime/duration`. Without it: synth bpm 104, 2.6s per line.
   - End → `mark(2)`, then a dashed card "Próximo: baixar o e-book".
3. **e-book.** Card: number, episodes, `ebookTitle`, scope, "Diálogo bilíngue, Take Away, exercícios e gabarito".
   - `plDownload`: "Baixando…" 1.3s → `ebooks[ebook]=true` → success card.
   - **PROD:** downloads the real PDF from R2 when present.
4. **Take a Look.**
   - With `sceneVideo`: `<video controls>`, `onended` → `mark(4)`. Otherwise a still image + `sceneNote`.
   - Cast chips (initials + color).
   - Visual vocab grid (`Ep.visual`), tap → TTS.
   - Note: these words go to Revisão (unlocked when moving past step 4).
5. **Take It In.**
   - Dock: play-all (`speakFrom`, line-by-line TTS with per-character voices), speed 0.75× / 1× / 1.25× (`plSpeed`).
   - Lines: WHO, EN, PT, optional err/hook note. Stage directions pause 900ms.
   - Desktop: EN/PT grid. Mobile: stacked.
   - `plLine` jumps to a line. Finishing the dialogue → `mark(5)`.
6. **Take the Mic (record).**
   - Dock: "Frase i de n", phrase, mouth tip, mic `plRecord`, Ouvir, waves, status.
   - `plRecord`: record (maxMs 7000) ‖ listen; auto-stop at 5.5s; `ai.pronounce` → `scores[ep-i]`; awards `mic_good` (≥8) or `mic_try`.
   - No mic available: uses the scripted `m.result` / `m.fb`.
   - Feedback card: score /10, `praise_pt`, "Entendi: …", per-word issues.
   - Training mode (shy diff, or `feedback='suave'`): the score is hidden behind "Ver nota" (`plShowScore`).
   - Phrase list with scores (`plMicPick`).
   - Copy: "A nota mede quanto da sua fala foi entendida, não quanto você soa americano."
7. **Take a Lesson.** `TIE.blocks(Ep.lesson, 'EVITE')` + pronunciation card (`pron.k`, parts, minimal pairs, word chips with TTS).
8. **Take Away.** `awayExp` (en, pt, note) and `awayWords` as `sayMark` buttons. Moving on adds them to Revisão.
9. **Take Action.**
   - One question at a time, starting at the first unanswered.
   - Header: "Exercício x de n · kind" + progress dots.
   - Optional audio (`plExAudio`): 'tts' says `item.say` or the quoted question at 0.9; 'song' plays the song.
   - Options A/B/C/D (`plEx("ep-x-j:i")`): right awards `ex_right` (+5); wrong plays the soft sfx. Options then lock and show right/wrong + `fix`.
   - `plExGo(±1)`.
10. **Take the Mic (sing-along).** Same renderer as step 2, copy "Agora é sua vez. Cante junto". End → `mark(10)` + awards `song`.

### Media cleanup
- `stopAll()` runs on step change and on leave.
- If autoplay is blocked → toast.

## 7. `concluido` (`#/concluido/:ep`)
- `done.title`, `done.line` (`{N}`), "+40 pontos".
- Stats: average Take the Mic score, card count.
- "A seguir": next number, title, sub, note.
- CTA `done.cta` → `go` (ep2 / ebook1 / inicio).

## 8. Extras

### `extra` (`#/extra`), navy theme
- Shelf tabs (`shelf`): pra-voce, series, novelas, filmes, animes, musica, games, + orange Desafio.
- `pra-voce`:
  - coverflow of the top 7 unlocked;
  - "why" rail;
  - one rail per profile format;
  - Música albums rail ("Karaokê com lacunas");
  - Desafio card with the record;
  - "Estreias sexta" rail (locked titles).
- `musica`: album grid.
- Other shelves: filtered grid, or "Toda sexta chega título novo".
- Ranking: `personalize.rankExtras`.

### `extraDetail` (`#/extra/:id`)
- Hero: scene image, kind, level, duration, title, episode label.
- Synopsis, why, cast chips.
- Locked: "Estreia sexta" + "Me avise quando chegar" (`notifyMe`).
- Unlocked:
  - "Assistir com legendas · +20";
  - "Dublar o {dub} · +10 por fala";
  - "Conversar com a Maggie sobre isto" → `maggie?modo=extra&x=id`;
  - vocab list with TTS.

### `extraPlay` (`#/extra/:id/assistir[?dub=1]`)
- A still scene image "played" with per-character TTS, line by line.
- Subtitles: EN / EN+PT / off (`vSubs`).
- Words are tappable (`word`) → sheet with the meaning (looked up in all extras' vocab) and the source line:
  - `wordSave` adds the line as a card and awards `word` (+3);
  - `wordClose`.
- Controls: `vPrev`, `vPlay`, `vNext`, `vRepeat` (0.75×), `vDubMode`, `vLine(i)`, `vRewind`.
- Dub:
  - pauses on the dub character's lines → "Sua vez" panel;
  - `vDub`: record 7s, auto-stop 5s, `ai.pronounce` → `extras.dubs[id]` (running average) and awards `dub`;
  - buttons Ouvir antes / Pular / Seguir a cena / Dublar de novo.
- End (`finishScene`): `seen[id]`, `lastId`; awards `extra` once.
  - End card: lines, words saved, dub average.
  - CTAs: talk to the assistant, challenge with these lines, watch again.
- Layout: desktop 2 columns (scene + controls | script); mobile stacked.

### `musica` (`#/extra/musica/:id`): karaoke
- Albums from `ALBUMS`; a track with `ep` uses that episode's lyrics plus `EP_GAPS`.
- `kPlay`: real audio with time-based lines, or synth with beat-based lines. End awards `song`.
- `kSel(i)`, `kTrack(±1)`.
- `kGapMode`: one blank per line with 3 options. `kGap(w)`: right awards `ex_right`; wrong shows a toast.

### `desafio` (`#/extra/desafio[?x=id]`): 60s lightning quiz
- An EN line falls; pick its PT from 3 options.
- Fall time `max(3200, 7000-score*12)` ms. Combo up to ×5, +10×combo per hit.
- `gStart`, `gPick(i)`.
- End: update `extras.best`; awards `ex_right` once if hits ≥5; "Novo recorde".

## 9. Mic (`#/maggie?modo=&m=&x=`)

### Modes
- `livre`, `missao` (default), `pronuncia`, `extra`.
- Training mode = `personalize.defaults.training`; it hides scores.

### Lobby
- Assistant picker (`mgPick(k)` → `profile.assistant`, speaks its hello).
- Mode cards (`mgMode`).
- Per-mode picker:
  - missao: mission chips (`mgMission`), profile goals first, marked "· seu objetivo"; shows role + goal;
  - extra: unlocked extras chips (`mgExtra`, "· visto");
  - livre: a line about topics;
  - pronuncia: "6 frases".
- "Começar a conversa · +30 pontos" (`mgCall`).
- demoBadge, "N de 60 min restantes no mês", warning when there is no SpeechRecognition.
- Desktop: "Como funciona" panel on the right.

### Call
- `secStart`; the minutes pill updates every 15s.
- Opener from the script.
- Video avatar: idle / talk / talk-happy / talk-soft by mood.
- Caption: EN, with optional PT.
- Transcript bubbles:
  - assistant: EN + PT + new-word pills (`mgWord` → addCard + `word`);
  - user: their text + feedback chips (certo / ajuste with the corrected text / natural, plus pronunciation tips);
  - coach cards.
- Dock:
  - help phrases (`mgHelp`, repeat slower);
  - "Me explica em português" (`mgCoach`);
  - Dica (`mgHint` fills the input);
  - PT toggle (`mgSubs`);
  - Mãos livres (`mgHands`);
  - text input (`data-ui="mgTyped"`, Enter → `mgSend`);
  - mic (`mgMic` → Web Speech, interim results).
- `send` → `ai.tutor`: awards `maggie_turn` {sec:20}. Ends on `r.end` or after 9 turns ("Ver o relatório").
- Pronunciation mode (`pronPanel`): 6 `MAGGIE.PRON` phrases, `mgPronHear`, `mgPronNav`, `mgPronRec` → `ai.pronounce` → `mic_good` / `mic_try` {sec:15}.
- `mgEnd` → `finish()` (also on leave when there are >1 turns):
  - prepends the session (≤12) with its full transcript;
  - `secLeft -= secs`;
  - awards `maggie_session` (+30) if the user spoke ≥2 times;
  - → report.

### `relatorio` (`#/maggie/relatorio/:id`)
- `ai.report` runs once while showing "está escrevendo o seu relatório…".
- Content:
  - summary;
  - stats "certas de primeira" / "expressões novas" (hidden in training mode);
  - "O que foi bem";
  - "O que ajustar": said vs better (TTS), category, why;
  - pronunciation words;
  - new words + "Levar N para a Revisão" (`repSave`);
  - "Próxima meta";
  - buttons Conversar de novo / Voltar.
- Badge: "Feito pela IA" / "Modo demo".

## 10. `revisao` (`#/revisao`)

### Cards and grading
- Deck card: `{en, pt, note?, scene, at, reps}`.
- `sync` adds `visual` cards after step 4 and `awayExp` cards after step 8. Manual adds come from extras, the Mic and reports. Dedup by `norm(en)`.
- Flash card (`flip`): scene source, EN + TTS; back: PT + note.
- Grades (`grade(i)`):

| Grade | Next review |
|---|---|
| De novo | <1 min |
| Difícil | 10 min |
| Bom | 2 days |
| Fácil | 5 days |

- Each grade awards `card` (+2).

### Empty states
- "Revisão em dia, próximo volta {nextIn}".
- "Seus cartões começam no episódio" + link.

### Info card
Where cards come from, plus the count of user-captured cards.

## 11. `conquistas` (`#/conquistas`)
- Level card: pill, points, bar to the next level.
- Gamebar.
- Missions.
- 14 medals (locked ones at 50% opacity).
- Static "how to earn points" table.

## 12. `perfil` (`#/perfil`): "Você"

### Header
Photo, name, email, level, CEFR/season, gamebar.

### Sections
| Section | Actions |
|---|---|
| Sua foto | 6 presets (`pfAvatar`); upload (`pfPhoto`, resized client-side to 256×256 JPEG); `pfPhotoClear`. **PROD:** upload goes to R2 and the moderation queue |
| Assistente | `pfAssistant` (speaks hello) |
| Nível | `pfLevel` (zero / basico / meviro / avancar → season / CEFR) |
| Objetivos | `pfGoal` (≤3) |
| Formatos | `pfFormat` |
| Gêneros | `pfGenre` |
| Temas | `pfTheme` |
| Dificuldades | `pfDiff`, `pfMain` |
| Estilos | `pfStyle` |
| Feedback | `pfFeedback` |
| Ritmo | days `pfDay`; minutes `pfMin` (toast with the new goal); reminders `pfRemAdd` / `pfRemDel` |
| "Do zero ao B2" | 8-bar CEFR ladder |
| Conversas no Mic | last 4 sessions → their reports |
| Leitura, som e efeitos | text size 1 / 1.12 / 1.25 (`setTs` → CSS `--ts`); toggles (`setToggle`): sound, fx, hd (refused when AI is offline), slow, remind |
| Plano | "Plano Padrão · 60 min de conversa no Mic por mês · N usados". **PROD:** show the real assigned plan name and quota |
| Sair | `logout` |
| Apagar dados | `wipe`. **PROD:** split into "Zerar progresso" and "Excluir minha conta" (LGPD), both with confirmation |

## 13. Moderation / privacy surfaces (PROD requirements)
1. Profile photo upload → R2 private + moderation queue.
2. Mic transcripts (user free text) → stored. Llama Guard flags them into the moderation queue. Transcripts have a retention period.
3. Voice recordings: scored only, never stored by default (the UI promises this). Flag `mic.store_recordings` is off.
4. Account data: full name, birth date (minors allowed; age band -18), email. Record terms acceptance.
5. Points, streaks and records must be server-authoritative.
