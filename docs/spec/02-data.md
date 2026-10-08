# Spec 02 — Content data structures, per-user state, business rules, media

Source: `prototipo/js/data/*`, `js/core/{store,game,review,guide,personalize}.js`.

## 1. Content (`js/data/*`)

### curriculum.js → `TIE.data = { STEPS, CAST, EB1_SCOPE, EPS, CHAT, LEAD, FIVE, REAL, TEST, TEST_ALL, norm, TITLES }`
- **STEPS** (10 fixed): `{ n, name, pt, group? }` — group on n=1 'ABERTURA', 4 'O EPISÓDIO', 10 'FECHAMENTO'.
- **CAST**: `name → [initials, hexColor]` (Zach, Margaret, Maggie(alias), Robert, Becky, Barbara, Lucas).
- **TITLES**: 20 episode titles; only EPS 1, 2, 5 have full content.
- **EPS** keyed by num:

| field | type | notes |
|---|---|---|
| num,title | int,str | |
| ebook | int | eps1–2→1, ep5→3 |
| ebookEps, ebookTitle, scope, synopsis | str | |
| introAudio, songAudio | path or '' | ep1 only has real audio |
| songTitle | str | |
| sceneVideo | path? | ep1 only |
| lyrics | [{en,pt}] | |
| sceneNote | str | |
| cast | [name] | |
| visual | [{en,pt}] | → SRS cards after step 4 |
| dialogTitle, dialogSub | str | |
| dialog | [{who,en,pt,stage?,err?,hook?}] | who '' or 'All' allowed |
| mic | [{en,tip,result 0-10,blue?,fb}] | result/fb = scripted demo score |
| lesson | [Block] | |
| pron | {k, parts[{b,t}], pairs[{a,b,c}], words[]} | |
| awayExp | [{en,pt,note?}] | → SRS cards after step 8 |
| awayWords | [str] | |
| ex | [Exercise] | |
| done | {title,line({N}),nextNum,nextTitle,nextSub,nextNote,cta,go:'ep2'|'ebook1'|'home'} | |

- **Block**: `{ k, title?, body?, body2?, rows?:[{en,pt?,q?,bad?,note?}], bullets?:[str], callout?, badLabel? }`.
- **Exercise**: `{ kind:'escrito'|'com áudio'|'música', title, intro?, audio?:'tts'|'song', audioLabel?, items:[{q, opts[3-4], a:int, fix?, say?}] }`.
- **TEST** (ebook 1): `[{title, qs:[{n,q,rev,ep,step?(def 7), opts?,a?,audio?, acc?:[str], show?}]}]` — 4 parts, 20 Qs; typed answers graded `acc.includes(norm(v))`; pass ≥14.
- **norm(x)**: lowercase, unify apostrophes, strip punctuation, expand `i am→i'm` (+she/he/it/who is), collapse spaces. Must be ported EXACTLY (tests compare with prototype).
- **FIVE**: [Block]; **REAL**: [{book,street,why}]; **LEAD**: [{m:{en,pt}, opts:[{en,pt,fix?}]}] ({N} in opts); **CHAT**: unused.

### extras.js → `{ EXTRAS, ALBUMS, EP_GAPS }`
- **EXTRAS** (9): `{ id, title, kind, format, genres[], themes[], level:'A1–A2'|'A2'|'B1', cefr 1..3, ep:'T1 · Ep. 3 · …', dur:'8 min', cover, scene, synopsis, cast:[[name,ini,color]], dub:castName, premiere?, locked?, lines:[{who,en,pt}], vocab:[[en,pt]] }` — 2 locked items have empty lines/vocab.
- **ALBUMS** (3): `{ id, title, sub, level, img, genres[], tracks:[{title, from, audio?, ep?, bpm?, key?(0-11), lines?:[{en,pt,gap}]}] }`; track with `ep` uses `EPS[ep].lyrics` + `EP_GAPS[ep][i]` (fallback first word).

### maggie.js → `MAGGIE = { MODES, OPENERS, FOLLOW, MISSIONS, PRON, HELP }`
- MODES `[{k:'livre'|'missao'|'pronuncia'|'extra', t, s, icon}]`; OPENERS by format key + `_` fallback `{en,pt}` ({N}); FOLLOW `[{en,pt,end?}]` (5); MISSIONS by goal key (viagem,carreira,morar,series,musica,provas,gente,games): `{t, role, goal, turns:[{en,pt,words:[[en,pt]],end?}]}` ({N},{A},{oA}); PRON `[{en,target,tip}]` (6); HELP `[{en,pt}]` (3).

### onboarding.js → `ONB`
STEPS (7: conta,objetivo,gostos,trava,estilo,ritmo,voz; `{k,t,h,s,skip?}`), AGES, OCCUP, AREAS, LEVELS `{k,t,s,season,cefr}` (zero/basico/meviro/avancar → seasons 1/1/3/5, CEFR A1/A1+/A2/B1), QUIZ (unused), GOALS `{k,t,s,icon}` (max 3), DEADLINES, HISTORY, FAILS, FORMATS `{k,t,img}` (9), GENRES by format (keys NOT unique across formats → store as `format:key`), THEMES (8), DIFFS `{k,t,icon}` (8), STYLES `[k,label,icon]` (6), COMPANY, FEEDBACK, DAYS ['D','S','T','Q','Q','S','S'], MINUTES [20,30,40,50], REMIND_MAX 5, MOTIVES.

### assistants.js (5): `{ k:'margaret'|'robert'|'rebecca'|'zach'|'barbara', name, full, art:'a'|'o', age, aka[], role, tag, style, hello{en,pt}, voice{gender,pitch,rate,tts,prefer?,preferPitch?,preferRate?}, persona }` + clips `idle,talk,talk-happy,talk-soft` → `assets/video/mic/<k>-<clip>.mp4`, poster `assets/img/gen/avatar/as-<k>-poster.webp`, thumb `as-<k>-thumb.webp`.

### Hardcoded in code (must move to DB): `curso.js` SEASONS(8), EXTRAS_EB, ebook chapter subtitles, season synopsis, ebook-2 teaser; `personalize.js` FOCUS {t,b,cta,go} per diff, FORMAT_WORD, FORMAT_THEME (viagens→viagem, business→negocios); `extra.js` SHELVES; `ai.js` RULES/PRAISE/hintFor; `game.js` POINTS/LEVELS/BADGES; `review.js` GRADES; `entrada.js` DEMO profile.

## 2. Per-user state (prototype `fresh()`, key `tie.v6`)
`user, profile, onbStep, draft, prog{ep:furthestStep}, ebooks{n:true}, epsDone{ep}, stepOk{'ep-step'}, scores{'ep-micIdx':0..10}, exAns{'ep-ex-item':optIdx}, testAns{n}, testDone, testScore, deck[{en,pt,scene,note?,at,reps?}], due, extras{seen,dubs(avg),best,lastId}, maggie{secLeft:3600, sessions[≤12]}, game{points,streak,lastDay,daily{date:{points,steps,cards,maggieSec,extras,mic,goal,missions}},badges[],log[≤400]}, settings{ts,sound,hd,trans,slow,remind,phone,fx,free}`.

profile = onboarding fields (name, fullName, birth, age band, occup, area, level, goals, formats, genres, themes, diffs, mainDiff, styles, company, feedback, days, minutes, reminders, voice) + assistant, avatar(1-6), photo; tutorContext also reads deadline, history, fails, motives, why.

Mic Session: `{id, at, assistant, mode, mission, extraId, secs, turns:[{who:'me'|'her', en, pt, fb, pron[{word,tip_pt}], words[{en,pt}]}], report}`; Feedback `{status:'certo'|'ajuste'|'natural', original, corrected, explain_pt, tip_pt?, cat}`; Report `{summary_pt, strengths[], fixes[{said,better,why_pt,cat}], pron[], words[], next_goal_pt, source}`.

## 3. Business rules
- **POINTS**: step 10, episode 40, ex_right 5, mic_try 5, mic_good 15, song 10, maggie_turn 5, maggie_session 30, extra 20, dub 10, card 2, quiz_hit 5, test_pass 50, mission 15, word 3.
- **LEVELS** [min,name]: 0 Iniciante, 100 Curioso, 250 Aprendiz, 500 Explorador, 900 Conversador, 1400 Viajante, 2000 Anfitrião, 2800 Narrador, 3800 Mestre de Beacon, 5000 Lenda de Beacon. `level()` → `{n,name,from,next,pct}`.
- **BADGES** (14): first-step, first-episode, first-talk, talk-10 (≥10 maggie_turn), mic-8, cinema, dub, cards-20, streak-3, streak-7, pts-500, test, song, goal-5 (≥5 goal days).
- **award(kind)**: touch streak (+1 if lastDay=yesterday else 1); daily counters; goal = max(50, round(minutes*5)); daily mission bonus +15 once/day; new badges. Toasts: level up (sfx level + confetti), goal hit, medal.
- **Daily missions**: always `step` (steps≥1); `cards` (≥5 graded or due=0) only if due>0||cards>0; then `extra`(extras≥1) or `maggie`(maggieSec≥120) — both if list<2 else by style 'vendo' or even day-of-month.
- **PROD fixes**: points idempotent per award key (prototype re-awards); days in user TZ (prototype uses UTC date); Mic quota resets monthly and is enforced.
- **SRS GRADES**: De novo 0, Difícil 10min, Bom 2d, Fácil 5d (fixed intervals), reps++.
- **Guide**: current episode = first EPS key not done; plan tasks ep(8min,10pts) / cards(3,10, if due) / maggie mission(5,30) / extra(8,20, if minutes≥20); ordered by style weights.
- **Personalize** rankExtras: format +4, genre +2, theme +1 (incl. FORMAT_THEME), goal series & screen format +1, CEFR gap 0:+1.5, 1:+0.5, else −1, locked −3, + `why` text. rankAlbums: musica format +2, genre +2. defaults: speed .75 if listening; subs both/en; training if shy or feedback suave; micro if time or minutes≤10.
- **Gating** `need()`: 1,2,10 audio ended; 3 ebook downloaded (always); 4 video ended if any; 5 dialog finished; 6 every mic phrase scored; 9 every item answered.

## 4. Media inventory
- `assets/` ≈32.5 MB: `video/cena-aula-1.mp4` 20.45 MB (ep1 scene), `.webm` 5.2 MB (unreferenced), `video/mic/*.mp4` 20 files ≈5.4 MB, `audio/{intro,musica}-aula-1.mp3`, `img/gen/{bg,cover,scene,k7,avatar}/*.webp` (~38, ≤0.37 MB), `svg/icon.svg`.
- Excluded from git and seed: `prototipo/temp/` (144 MB mp4), `prototipo.zip`. `personagens/*.pdf` = character guides (reference only).
- Hardcoded asset refs: `bg/home.webp`, `bg/login.webp`, `bg/maggie-set.webp`, `scene/cafe-counter.webp`, `svg/icon.svg`.
