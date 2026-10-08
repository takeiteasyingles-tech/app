# Spec 05: Notes from the foundation verifier, for the slice agents

The foundation (F0) has been built and verified. The first section lists known issues; each slice applies the ones that fall in its area. The second section lists conventions every slice follows.

## Known minor issues

### Assigned to a slice

| # | Area | Issue | Fix | Owner |
|---|---|---|---|---|
| 1 | Assistants content | `AssistantRow` (admin contract) leaves out `persona`, but the `persona` column is `NOT NULL`. | Create requires an optional `persona`; insert `''` when it is absent. Editing `persona` requires the `ai.persona` permission. | S10 |
| 2 | `@tie/ui` `Flow` | `Flow` resets when the identity of the `items` array changes. | Memoize `items` in screens, or key `Flow` on the joined ids. | S6 |
| 3 | Staff passwords | Only 6 characters are required. | Add `StaffPassword` (min 10) for admin invite accept and admin password change. | S10 |
| 4 | Content schema | `Episode.sceneImage` and `Ebook.teaser` have no columns. | `compile.ts` reads them from the `content_blobs` keys `scene_images` and `ebook_teasers`, and the seed must create those blobs. | S9 |

### Assigned to the integration agent

| # | Area | Issue | Fix |
|---|---|---|---|
| 5 | `csrf.ts` | It accepts the request's own origin as well as `APP_ORIGIN`. | When `APP_ORIGIN` is set and is not local, compare only against it. |
| 6 | `upload.ts` | Any `ftyp` file counts as mp4. | Allowlist the major brands; reject heic, avif and mov. |
| 7 | Vite dev proxy | Origin mismatch blocks requests. | Rewrite `Origin` in the proxy, or develop against the wrangler-served build. |
| 8 | `npm` `allowScripts` | Install scripts for esbuild and workerd are not allowed. | Add `allowScripts` for esbuild and workerd. |

`wrangler.jsonc` vars are empty and the dev values live only in `.dev.vars.example`. Every dev, parity or e2e script must copy `.dev.vars.example` to `.dev.vars` when it is missing.

## Conventions for parallel slices

- **Ownership.** Only touch your owned directories. Shared contracts live in `@tie/shared`. If a contract must change, make an additive change and report it.
- **Dependencies.** They are installed at the root. Do not run `npm install` unless you must (`-w <ws>`, and retry on a lock error).
- **Local servers.** Never run anything on the default ports when the parity harness provides slots. Use the slot ports, persist dirs and out dirs it assigns to you.
- **Typecheck and tests.** Scope them to your own workspace or files. Other slices are being edited at the same time, so errors in other slices' directories are not yours to fix.

## Accepted production deviations

Screens that knowingly depart from the prototype's markup (the golden rule's "same DOM/classes"), because the prototype had a placeholder, a layout defect or a weaker behaviour there. Every behaviour in 01-features still works. The DOM-signature diffs against `prototipo/` for these routes are expected.

### U2: Episode player and Concluído (`screens/player`, `screens/concluido`)

The aside stays 300px and the content wrap 760px, as in the prototype. Every step keeps the prototype's head, dock, foot, gating copy and step markup except for the rows below. An extra `.pl-scr` wrapper is the slice's CSS scope; on mobile it is `display: contents`, so the head, dock, scroll and foot are still flex items of the view.

| Screen | Deviation | Why |
|---|---|---|
| Episode map (aside and sheet) | The status ("Feito" / "+10") sits on the step name's line; "Você está aqui" sits under the subtitle. | Beside the text (the prototype) they squeezed the subtitles onto 2–3 lines in the 300px aside. |
| 1 · Intro | The time shows the real duration ("0:00 / 0:02", from the file's metadata). A card "Neste episódio você aprende" (the lesson blocks' titles in sentence case) and "Quem aparece" sits under the paragraph. | The prototype showed "0:00 / —" and half a screen of empty space. |
| 1 and 4 · Cast | Phone: an even strip (avatar over name). Desktop: one row of equal avatar + name pills. Every avatar is navy; the character's colour (the same as its dot in Take It In) is the ring. | The wrapping pills left a ragged 3 + 2 on phones. |
| 2 and 10 · Song | A line the song repeats back to back shows once with a "×N" badge, and the highlight and auto-scroll follow the audio through it. Step 10's sing-along instruction scrolls with the lyrics, outside the fixed dock. Step 2's dashed "Próximo: baixar o e-book N." card has a title line and a sentence line, and a navy icon disc and a chevron. The "Tradução" toggle exposes `aria-pressed`. | The prototype listed "Bye! Bye! See you soon." twice, and its dock was tall. |
| 3 · E-book | Contents as check chips instead of a grey sentence. After the download, the success line has "Abrir no app" (#/ebook/N) and "Baixar de novo" (the real PDF), and a dashed "Próximo: Take a Look" card follows it. | Production has the real file. The prototype's downloaded state had no actions. |
| 4 · Take a Look | A clean poster with one play button and the duration in the lower-left corner; native controls appear once the video plays. The vocabulary cards have a speaker icon; on desktop they sit 4 per row, with the icon above the word. | The prototype exposed the raw browser controls, and its vocabulary had no affordance. |
| 5 · Take It In | A coloured dot before each speaker's name. Stage directions keep normal height. The desktop translation column has a divider. | tie.css's `.stage { min-height: 100dvh }` made "(the doorbell rings)" a full screen tall in the prototype, which hid the rest of the dialogue. |
| 6 · Take the Mic | The waveform has a `done` state for a phrase with a stored score. On a phone the status sits on its own line. "Ver nota" is a navy button. In training mode the card is a neutral `.fb.tip`, and recorded phrases show a neutral check (`.pl-recd`) instead of colours that would give the score away. | The prototype's "Ver nota" was bare link text, and its green/blue card and checks revealed the hidden score. |
| 7 · Take a Lesson | Each block has an orange top rule and more air between blocks. Desktop: a "Nesta lição" outline that jumps to each block. Minimal pairs as `.pl-pair` (word ≠ word, gloss underneath) in 2 columns on desktop, instead of `.grid2`. | The page is very long, and the prototype's pairs sat far apart without the ≠. |
| 8 · Take Away | Each expression shows English over its translation, left-aligned (`.pl-exp`), in 2 columns on desktop. The desktop keywords sit in an even grid whose column count leaves no chip alone on a row. | The prototype pushed the translation to the far right and wrapped both mid-phrase. |
| 9 · Take Action | Header and dots as in the prototype. Desktop: the options of a question with 3 or 4 options sit in a row or a 2 × 2 grid. Under the navigation: "Exercícios desta etapa · n de m respondidas" and one card per exercise (`.pl-exlist`), which jumps to its first unanswered question. | The prototype had no overview of the step's 21 questions. |
| 10 → Concluído | Concluído opens only after the server records `episode-done` (or the request is queued offline). A refusal keeps the learner on step 10 with the server's message. The player's step-ok, advance and episode-done calls go out one at a time. | The prototype had no server. Opening Concluído before a refusal would show a "+40 pontos" the learner never got. |
| Concluído | A trophy medallion beside the badge and a few static confetti pieces in the card. On desktop the column is centred vertically. | Once the confetti burst ended, the prototype's hero was flat. |

The episode JSON still ships the exercise key (`items[].a`) and the scripted Mic results. The server grades exercises (the first answer is final), and it derives the score itself for a scripted Mic result. Optional hardening: drop `a` from the public file and colour the answer from `ExerciseRes.answer` plus the stored `exAns`.

### U3: Trilha and e-book 1 (`screens/trilha`, `screens/ebook`)

| Screen | Deviation | Why |
|---|---|---|
| Trilha | The season bar counts steps (episode 1 at step 6 = 3%) and its figure says so ("3% das etapas"); "n de 20 episódios concluídos" and an orange "Agora: 01 … · etapa N de 10" link sit under it (desktop: a "Progresso da temporada" head, then count and "Agora" on one line; phone: the prototype's bar + figure row). On a phone the current node's subtitle is two lines (step name, then "etapa N de 10"); on desktop one line. | The prototype's bar stayed empty at "0 de 20" while the trail said "etapa 6 de 10". A bare "3%" next to "0 de 20" read as a contradiction. |
| Trilha | Locked rows keep full opacity, with a muted title, the number in solid `--navy3`, and a single lock in the trail dot (none at the row's end). A segment of the line runs through each chapter label. E-books 4–10 take the title of their first episode when the e-book has none. | The prototype's `.node.locked { opacity: .55 }` made the titles low-contrast, its lock floated apart from the line, and its line broke at every chapter. |
| Trilha (desktop) | Two columns inside the one `.trail`: e-books 1–5 and 6–10, each column one unbroken line that starts at a column head ("Episódios 01 a 10 · E-books 1 a 5" with "Você está aqui" / "Concluídos" / "Depois do episódio 10") carrying its own stop on the line. | A single 700px column left most of the 1190px main empty, and the page was very long. |
| E-book hub | A `DeskHead` (back + kicker + h1) inside the content column on desktop. Episode lines say "Em andamento · etapa N de 10" or "Concluído · abrir de novo". The four extras keep the prototype's card grid (2 columns of equal-height rows on desktop); a playable one has a chevron by its meta, and Take It Out ("Em produção") is the same card dashed (1.5px, like "Na próxima"). On desktop the test card and "Na próxima" sit side by side. | The prototype's header was misaligned with the content, and episode 1 said "A fazer" mid-episode. |
| E-book parts | They keep the tab bar / side nav (the prototype used `tabs:false`). On desktop the intro line sits in the `DeskHead`, under the title. | Navigation stays available, as on every other content screen. |
| Take Five | Page index chips: on mobile a sticky one-line strip, on desktop a sticky column with the reading progress and a "Depois daqui" card (Take the Lead, Take it for Real, the test). Each lights the page being read. Every page shows "Página i de 5". The EVITE line is a red label over dark text with a soft red strike. | The prototype had no page navigation, and its blue strike-through read as a link. |
| Take it for Real | "No livro" / "Na rua", and "Não está no livro" instead of a bare "—". Phone: the `.cmp` rows with the why under a divider. Desktop: one row per tip, three columns (book, street, why behind a divider). | The bare dash read as missing data. |
| Take the Lead | Lettered `.opt` rows instead of `button.card`. Margaret's bubbles carry an avatar and name. The scene card shows "n de 5 falas". Help phrases are tiles. On desktop the chat is a screen-tall panel with the answers at its foot, and the scene and help sit in a sticky side column. | In the prototype every option had a thick navy border, so all of them looked selected, and there was no sense of progress. |
| Take the Lead | A right answer awards `quiz_hit` with the key `lead-eb{n}:{turn}` (+5, once per turn per day), not `maggie_turn`. The server accepts only real turns (`0 ≤ turn < ` the e-book's `lead` length, `worker/src/game/keys.ts`), so forged turn numbers pay nothing. | Anti-farming. `maggie_turn` is kept for real Mic conversations and the Mic medals. |
| Teste | A sticky progress row with "Entregar". A choice question shows all its options in one row when they are short, and one per row otherwise. "Ouvir o áudio" is a blue tinted chip, not an option-like outline button. Typed answers are capped at `LIMITS.freeTextMax`. On desktop: a 2-column card grid of equal widths, where an odd last card spans the row sideways (question left, answer aligned with the right column); "O que revisar · N"; and a 2-column review. | The prototype's submit sat only at the very end of a 20-question form. |
| Teste | The answer key (`a`/`acc`) still ships in `ebook/1.json`. It is used only for the review list after a reload, when the server's per-question grade is no longer in memory. Grading and `test_pass` are server-only and pay out once per e-book. | Known. Optional hardening: serve the review from a GET result endpoint, and drop `a`/`acc` from the public file. |

### U1: Entrar, cadastro and perfil (`screens/entrada`, `screens/cadastro`, `screens/perfil`)

Every step and section keeps the prototype's DOM structure and classes (`tools/e2e/specs/U1-auth.spec.ts` asserts it for cadastro 2–7, ignoring inline styles). Most rows below are inline styles only. The full per-route diffs are in `tools/e2e/out/u1-auth/dom-*-{mobile,desktop}.diff.txt`.

| Screen | Deviation | Why |
|---|---|---|
| Entrar | Real login with Turnstile. There are no Google/Apple buttons and no demo account. "Esqueci a senha" points to support. The footer links the Termos de Uso and the Política de Privacidade (`?doc=` sheets, links bold and underlined at .875rem) instead of "Protótipo: nenhum dado sai do seu navegador." The card has a subtitle, "Que bom ver você de novo. A história continua." (`text-wrap: pretty`). | Spec 01 §1. The prototype's card had no subtitle, and its footer was placeholder copy. |
| Entrar (mobile) | A navy veil over the top of the hero photo and extra bottom padding. | The tagline "INGLÊS PARA QUEM FALA PORTUGUÊS" landed on the café's sign. |
| Entrar (desktop) | The form column is 520px wide with 40px padding. The hero photo is positioned at 62% 42%. | The prototype's card was cramped against the panel's right edge. |
| Cadastro 1 | Signed in, e-mail and password are locked fields: a darker beige fill, a dashed border and a navy padlock. The password is never shown. The terms line links both documents. The empty date input shows its placeholder colour. | The account already exists. The prototype's "dd/mm/aaaa" looked like a typed value. |
| Cadastro (all steps) | Desktop: 28px padding under the footer. The disabled Continuar has a readable colour (`--bg #E2DBC6`, `--fg #3C4357`, a dashed edge) instead of white on #C9C2AE. | The prototype's disabled CTA was about 1.8:1 contrast. |
| Cadastro 2 and 4 (desktop) | The `.optcard`s sit in 2 columns. | One full-width column pushed the CTA below the fold. |
| Cadastro 3 | An empty check circle gets a darker fill and a shadow. | The prototype's circle disappeared on busy photos. |
| Cadastro 5 | A counter line ("Marque pelo menos um para continuar" / "N escolhidos"). The labels sit in a two-line, top-aligned box. The "ear" icon is drawn as headphones. | Nothing in the prototype said why Continuar was disabled, and "Vendo vídeos" wrapping left the labels of its row at different heights. |
| Cadastro 6 | Desktop: the days span the column as 56px-tall tiles, and the minutes form 4 equal columns. Phone: the minutes form a 2 × 2 grid. Days carry full weekday names as `aria-label`. | The prototype's 92px squares were out of scale, and "50 min" wrapped alone onto a second row on phones. |
| Cadastro 7 | Desktop: the stage is 2:1 and the meter is at most 420px wide. The status pill text is white. The meter has a resting pale-blue waveform. The mic button's `aria-label` is "Parar a gravação" (with `aria-pressed`) while recording. The footer copy has no "modo demo" wording. | The prototype's "Maggie" pill was navy on navy, its waveform was a flat line, and its stage pushed the mic below the fold. |
| Perfil (mobile) | A sticky row of shortcuts (Foto, Gostos, Ritmo, Ajustes, Conta). The assistant row fades at its right edge while more cards remain. | A 12000px page had no in-page navigation, and the cut-off card had no scroll cue. |
| Perfil (desktop) | The header, the assistant row and the tip span the width. Below them, two columns end level: photo, ladder, rhythm, Mic sessions, settings, plan and "Seus dados" on the left; level and tastes on the right. Sair sits under both columns. The days are at most 420px wide. | The prototype was one 680px column on a 1440px screen. |
| Perfil | "Seus dados": "Baixar meus dados" (the LGPD export), "Zerar progresso" and "Excluir minha conta". Both destructive actions are confirmed, and deleting also asks for the password. These replace "Apagar dados do protótipo". The photo copy and the HD voice hint are production copy. The plan card shows the real plan and AI minutes. | Spec 01 §12. |
