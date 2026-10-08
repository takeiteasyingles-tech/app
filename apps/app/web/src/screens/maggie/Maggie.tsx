// Mic: conversa com o assistente escolhido (Maggie, Robert, Becky, Zach ou Barbara), com avatar em
// vídeo, voz, quatro modos, retorno a cada fala e relatório no fim. Port de prototipo/js/screens/
// maggie.js (mesmo DOM, classes e textos). A conversa é uma sessão do servidor (POST
// /api/mic/sessions → /api/tutor → /end); quando o servidor não responde, o cérebro demo do cliente
// segue a cena e as falas locais vão junto no /end. A rota continua #/maggie.
import type { Bilingual, Catalog } from '@tie/shared/content/schema';
import type { Feedback, PronounceResult, PronTip } from '@tie/shared/contracts/ai';
import { meApi } from '@tie/shared/contracts/me';
import { type ClientTurn, micApi, type StartSessionRes } from '@tie/shared/contracts/mic';
import { norm } from '@tie/shared/domain/norm';
import { defaults, missions, tutorContext } from '@tie/shared/domain/personalize';
import { ApiError } from '@tie/shared/errors';
import type { MicSession } from '@tie/shared/state';
import { activator, assistInitials, Btn, Icon, Stage, toast } from '@tie/ui';
import { type ComponentChildren, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { hint as aiHint, aiOnline, pronounce as aiPronounce, tutor as aiTutor } from '../../core/aiClient';
import { sfx } from '../../core/sound';
import * as speech from '../../core/speech';
import { type ScreenProps, useChrome } from '../../frame';
import { go } from '../../router';
import { layoutOf } from '../../shell';
import { addCards, endMicSession, send as sendAction } from '../../store/actions';
import { catalog, catalogImage, loadCatalog } from '../../store/content';
import { set, state } from '../../store/state';
import { AiBadge } from '../../ui-blocks/chrome';
import { AvatarVideo } from './Avatar';
import {
  assistant,
  fmt,
  isLocalSession,
  LOCAL_PREFIX,
  mission,
  modeCard,
  noteSessionAward,
  of,
  putSession,
  sessionTitle,
  syncAwardFromServer,
  The,
  the,
  uid,
  usableExtras,
} from './data';

type Mode = 'livre' | 'missao' | 'pronuncia' | 'extra';
const MODES: readonly Mode[] = ['livre', 'missao', 'pronuncia', 'extra'];

/** Uma fala do transcript. `local`: produzida no cliente, vai como turno no /end. */
type Turn =
  | { who: 'her'; en: string; pt: string; words: Bilingual[]; local?: boolean }
  | { who: 'me'; en: string; fb?: Feedback | null; pron?: PronTip[]; local?: boolean }
  | { who: 'coach'; said: string; hintEn: string; hintPt: string };

interface Last {
  mood: string;
  hint_en: string;
  hint_pt: string;
}

interface Session {
  stage: 'lobby' | 'call';
  mode: Mode;
  mission: string;
  extraId: string;
  /** Sessão do servidor; null roda tudo no cliente (sem conexão ao começar). */
  id: string | null;
  turns: Turn[];
  turn: number;
  busy: boolean;
  listening: boolean;
  interim: string;
  subsPt: boolean;
  hands: boolean;
  secStart: number;
  last: Last | null;
  pronIdx: number;
  pronState: 'idle' | 'rec' | 'busy';
  pronRes: PronounceResult | null;
  stopper: (() => void) | null;
  /** O aviso de que a prática do modo demo pontua no fim já apareceu nesta conversa. */
  demoNote: boolean;
  ended: boolean;
  ending: boolean;
  speaking: boolean;
  mood: string;
  typed: string;
  q: string;
}

// Estado da conversa, como o M do protótipo: vive enquanto a tela está montada.
let M: Session | null = null;
let listener: { stop(): void } | null = null;
let rerender: () => void = () => {};
const re = () => rerender();

const S = () => state.value;
const C = (): Catalog | null => catalog.value;

function newSession(c: Catalog, q: Readonly<Record<string, string>>): Session {
  const s = S();
  const mode: Mode = MODES.includes(q.modo as Mode) ? (q.modo as Mode) : 'missao';
  const mine = s.profile ? missions(s.profile, c) : [];
  const extras = usableExtras(c, s);
  // Um link velho (cena ou Extra que não existe mais) cai na escolha padrão, nunca numa cena vazia.
  const knownMission = (k: string | null | undefined) => !!k && c.mic.missions.some((x) => x.k === k);
  const usableExtra = (id: string | null | undefined) => !!id && extras.some((x) => x.id === id);
  const pickMission = [q.m, mine[0]?.k, c.mic.missions[0]?.k].find(knownMission);
  const pickExtra = [q.x, s.extras.lastId, extras[0]?.id].find(usableExtra);
  return {
    stage: 'lobby',
    mode,
    mission: pickMission || 'gente',
    extraId: pickExtra || 'woods-and-beans',
    id: null,
    turns: [],
    turn: 0,
    busy: false,
    listening: false,
    interim: '',
    subsPt: true,
    hands: false,
    secStart: 0,
    last: null,
    pronIdx: 0,
    pronState: 'idle',
    pronRes: null,
    stopper: null,
    demoNote: false,
    ended: false,
    ending: false,
    speaking: false,
    mood: 'happy',
    typed: '',
    q: JSON.stringify(q),
  };
}

/** Sessão para o cérebro demo e para /api/tutor. */
function sessFor(c: Catalog, m: Session) {
  const A = assistant(c);
  const p = S().profile;
  return {
    id: m.id,
    mode: m.mode,
    mission: m.mission,
    extraId: m.extraId,
    ctxFormats: p?.formats ?? [],
    name: p?.name ?? '',
    aName: A.name,
    aThe: the(A),
    turn: m.turn,
  };
}

function stopListening(): void {
  if (listener) {
    listener.stop();
    listener = null;
  }
  if (M) {
    M.listening = false;
    M.interim = '';
  }
}

function hangup(): void {
  stopListening();
  speech.stop();
  if (M) M.speaking = false;
}

/** maggieSays: fala em inglês com a voz do assistente; no modo mãos livres o microfone liga depois. */
let sayTurn = 0;
function maggieSays(en: string, opt: { rate?: number } = {}): Promise<void> {
  const c = C();
  if (!M || !c) return Promise.resolve();
  const mine = ++sayTurn;
  M.speaking = true;
  re();
  return speech.say(en, { who: assistant(c).name, ...opt }).then(() => {
    // Uma fala anterior cortada por esta termina depois que esta começou: não desliga o avatar.
    if (!M || mine !== sayTurn) return;
    M.speaking = false;
    re();
    if (M.hands && M.stage === 'call' && !M.ended && M.mode !== 'pronuncia') startListening();
  });
}

function focusInput(): void {
  (document.getElementById('mg-input') as HTMLInputElement | null)?.focus();
}

function startListening(): void {
  if (!M) return;
  if (!speech.canListen) {
    toast('Este navegador não reconhece fala. Digite a resposta.');
    focusInput();
    return;
  }
  speech.stop();
  M.speaking = false;
  M.listening = true;
  M.interim = '';
  sfx.rec();
  re();
  listener = speech.listen({
    onInterim: (t) => {
      if (!M) return;
      M.interim = t;
      re();
    },
    onFinal: (t) => {
      if (M) {
        stopListening();
        void sendLine(t);
      }
    },
    onEnd: (t) => {
      if (M?.listening) {
        stopListening();
        if (!t) toast('Não ouvi nada. Toque no microfone e fale perto do aparelho.');
        re();
      }
    },
    onError: (e) => {
      if (!M) return;
      stopListening();
      if (e === 'not-allowed' || e === 'service-not-allowed')
        toast('O microfone está bloqueado. Libere nas permissões do navegador ou digite.');
      else if (e !== 'no-speech' && e !== 'aborted')
        toast(`O reconhecimento de fala falhou (${e}). Digite a resposta.`);
      re();
    },
  });
}

// ---------- Ações (TIE.act.mg*) ----------

function mgBack(): void {
  if (history.length > 1) history.back();
  else go('inicio');
}

/** Troca de assistente (vale para as próximas conversas): o personagem se apresenta. */
function mgPick(k: string): void {
  const c = C();
  const p = S().profile;
  if (M?.stage !== 'lobby' || !c || !p) return;
  const next = assistant(c, k).k;
  void sendAction(
    meApi.profile,
    { body: { assistant: next } },
    {
      optimistic: (s) => (s.profile ? { profile: { ...s.profile, assistant: next } } : undefined),
      apply: (r) => ({ profile: r.profile }),
    },
  );
  speech.stop();
  re();
  setTimeout(() => {
    const cc = C();
    if (M && cc) void maggieSays(assistant(cc).hello.en);
  }, 300);
}

function setMode(k: Mode): void {
  if (!M) return;
  M.mode = k;
  re();
}

function mgSubs(): void {
  if (!M) return;
  M.subsPt = !M.subsPt;
  re();
}

function mgHands(): void {
  const c = C();
  if (!M || !c) return;
  M.hands = !M.hands;
  toast(
    M.hands
      ? `Mãos livres: depois de cada fala ${of(assistant(c))} o microfone liga sozinho.`
      : 'Mãos livres desligado.',
  );
  re();
}

/** Erros em que a conversa segue no cliente (rede, servidor fora, limite): o resto volta ao lobby. */
const runsLocally = (err: unknown): boolean =>
  !(err instanceof ApiError) || err.code === 'internal' || err.code === 'rate_limited' || err.code === 'quota_exceeded';

async function mgCall(): Promise<void> {
  const c = C();
  const m = M;
  if (!m || !c || m.stage !== 'lobby' || m.busy) return;
  const A = assistant(c);
  m.stage = 'call';
  m.secStart = Date.now();
  m.turns = [];
  m.turn = 0;
  m.busy = m.mode !== 'pronuncia';
  if (m.mode === 'pronuncia') {
    m.pronIdx = 0;
    m.pronRes = null;
    setTimeout(() => {
      if (M === m)
        void maggieSays(
          `Hi, ${S().profile?.name ?? ''}. Let’s practice some tricky sounds. Listen first, then say it.`,
        );
    }, 500);
  }
  re();

  let started: StartSessionRes | null = null;
  try {
    started = await call(micApi.start, {
      body: {
        assistant: A.k,
        mode: m.mode,
        ...(m.mode === 'missao' ? { mission: m.mission } : {}),
        ...(m.mode === 'extra' ? { extraId: m.extraId } : {}),
      },
    });
  } catch (err) {
    if (M !== m) return;
    if (!runsLocally(err)) {
      // Missão ou Extra que o servidor recusou (plano, conteúdo): volta para o lobby com o motivo.
      hangup();
      m.stage = 'lobby';
      m.busy = false;
      toast(errorMessage(err));
      re();
      return;
    }
  }
  if (M !== m) return;
  if (started) {
    m.id = started.id;
    // Sem IA o servidor responde 0 (nada é cobrado): os minutos do plano continuam os mesmos.
    const left = started.quotaLeftS;
    if (left > 0 || aiOnline.value) set((st) => ({ maggie: { ...st.maggie, secLeft: left } }));
  }
  if (m.mode === 'pronuncia') return;

  let o = started?.opener;
  if (!o) {
    const [d, cat] = await Promise.all([import('@tie/shared/demo/index'), loadCatalog()]);
    if (M !== m) return;
    o = d.opener(sessFor(cat, m), { mic: cat.mic, extras: cat.extras });
  }
  m.busy = false;
  m.turns.push({
    who: 'her',
    en: o.reply_en,
    pt: o.reply_pt,
    words: o.words.map((w) => ({ en: w.en, pt: w.pt })),
    local: !started,
  });
  m.last = { mood: o.mood || 'happy', hint_en: o.hint_en, hint_pt: o.hint_pt };
  m.mood = 'happy';
  re();
  setTimeout(() => {
    if (M === m) void maggieSays(o.reply_en);
  }, 500);
}

function mgMic(): void {
  if (!M || M.busy || M.ended) return;
  if (M.listening) {
    stopListening();
    re();
    return;
  }
  startListening();
}

function mgSend(): void {
  if (!M) return;
  const t = M.typed.trim();
  if (!t || M.busy || M.ended) return;
  M.typed = '';
  void sendLine(t);
}

async function sendLine(text: string): Promise<void> {
  const c = C();
  const m = M;
  if (!m || !c || m.stage !== 'call') return;
  const me: Extract<Turn, { who: 'me' }> = { who: 'me', en: text };
  m.turns.push(me);
  m.busy = true;
  m.mood = 'thinking';
  re();
  const r = await aiTutor(sessFor(c, m), text);
  if (M !== m) return;
  me.fb = r.feedback;
  me.pron = r.pron_watch || [];
  me.local = r.local;
  m.turn++;
  m.busy = false;
  m.last = { mood: r.mood, hint_en: r.hint_en, hint_pt: r.hint_pt };
  // O prêmio maggie_turn de uma resposta do servidor já tocou em aiClient.tutor.
  m.turns.push({ who: 'her', en: r.reply_en, pt: r.reply_pt, words: r.new_words || [], local: r.local });
  m.mood = r.mood || 'happy';
  if (r.end || m.turn >= 9) m.ended = true;
  re();
  void maggieSays(r.reply_en);
}

const lastHer = (m: Session) => m.turns.filter((t): t is Extract<Turn, { who: 'her' }> => t.who === 'her').at(-1);

function mgHelp(en: string): void {
  const c = C();
  if (!M || !c) return;
  const h = c.mic.help.find((x) => x.en === en);
  const last = lastHer(M);
  if (!h || !last || M.busy) return;
  M.turns.push({ who: 'me', en: h.en, local: true });
  M.turns.push({ who: 'her', en: last.en, pt: last.pt, words: [], local: true });
  re();
  void maggieSays(last.en, { rate: en === 'Slowly, please.' ? 0.7 : 0.85 });
}

async function mgCoach(): Promise<void> {
  const c = C();
  const m = M;
  if (!m || !c) return;
  const last = lastHer(m);
  if (!last) return;
  const h = m.last?.hint_en ? { en: m.last.hint_en, pt: m.last.hint_pt } : await aiHint(last.en);
  if (M !== m) return;
  m.turns.push({ who: 'coach', said: last.pt, hintEn: h.en, hintPt: h.pt });
  re();
}

function mgHint(): void {
  const h = M?.last;
  if (!M || !h?.hint_en) return;
  M.typed = h.hint_en;
  re();
  focusInput();
  toast(`Dica: ${h.hint_pt}`);
}

async function mgWord(i: number, en: string): Promise<void> {
  const c = C();
  const t = M?.turns[i];
  if (!c || !t || t.who !== 'her') return;
  const w = t.words.find((x) => x.en === en);
  if (!w) return;
  const key = norm(w.en);
  if (S().deck.some((d) => norm(d.en) === key)) {
    toast('Já está na sua Revisão.');
    return;
  }
  const r = await addCards([{ en: w.en, pt: w.pt, scene: `Mic · ${assistant(c).name}` }], 'mic');
  if (!r) return;
  toast(r.added ? `Levei “${w.en}” para a Revisão.` : 'Já está na sua Revisão.');
}

function mgPronHear(): void {
  const c = C();
  const it = M && c?.mic.pron[M.pronIdx];
  if (it) void maggieSays(it.en, { rate: 0.85 });
}

function mgPronNav(d: number): void {
  const c = C();
  if (!M || !c) return;
  const n = c.mic.pron.length;
  M.pronIdx = Math.max(0, Math.min(n - 1, M.pronIdx + d));
  M.pronRes = null;
  M.pronState = 'idle';
  re();
  const it = c.mic.pron[M.pronIdx];
  if (it) void maggieSays(it.en, { rate: 0.85 });
}

async function mgPronRec(): Promise<void> {
  const c = C();
  const m = M;
  if (!m || !c) return;
  const it = c.mic.pron[m.pronIdx];
  if (!it) return;
  if (m.pronState === 'rec') {
    m.stopper?.();
    return;
  }
  if (m.pronState === 'busy') return;
  let rec: Awaited<ReturnType<typeof speech.record>> | null = null;
  let heard = '';
  let lis: { stop(): void } | null = null;
  if (speech.canRecord) {
    try {
      rec = await speech.record({ maxMs: 7000 });
    } catch {
      rec = null;
    }
  }
  if (M !== m) {
    void rec?.stop();
    return;
  }
  if (!rec) toast('Sem microfone: a nota fica estimada.');
  speech.stop();
  sfx.rec();
  m.pronState = 'rec';
  m.pronRes = null;
  re();
  if (rec && speech.canListen)
    lis = speech.listen({
      onInterim: (t) => {
        heard = t;
      },
      onFinal: (t) => {
        heard = t;
      },
    });
  m.stopper = async () => {
    m.stopper = null;
    lis?.stop();
    m.pronState = 'busy';
    re();
    const out = rec ? await rec.stop() : { b64: '' };
    const r = await aiPronounce(out.b64, it.en, { heard, ...(m.id ? { sessionId: m.id } : {}) });
    if (M !== m) return;
    m.pronRes = r;
    m.pronState = 'idle';
    const good = r.score >= 8;
    const said = r.heard || heard;
    const demoTry = r.source !== 'ia';
    m.turns.push({
      who: 'me',
      // Como no protótipo (r.heard || heard || it.en): toda tentativa conta como uma fala sua.
      en: said || it.en,
      fb: {
        status: good ? 'certo' : 'ajuste',
        original: r.heard || '',
        corrected: good ? '' : it.en,
        explain_pt: r.praise_pt,
        cat: 'Pronúncia',
      },
      pron: (r.issues || []).map((x) => ({ word: x.word, tip_pt: x.tip_pt })),
      // A IA do servidor já guardou a tentativa na sessão; a do modo demo vai inteira no /end, mesmo
      // sem microfone (a frase-alvo no lugar do que foi ouvido), e o relatório conta essa fala.
      local: demoTry,
    });
    re();
    if (!demoTry) {
      // Com a IA, o servidor pontua a tentativa (maggie_turn): os efeitos tocam a partir do resumo.
      if (m.id) void syncAwardFromServer(15);
    } else if (m.id && !m.demoNote) {
      // Tentativa do modo demo: o servidor não confirma a nota, então não há maggie_turn por frase
      // (spec 04: turnos do cliente nunca pontuam sozinhos). O tempo de prática de cada tentativa
      // entra no fim, no prêmio maggie_session do /end (maggieSec por fala). Avisa uma vez.
      m.demoNote = true;
      toast('Modo demo: cada frase não pontua sozinha. Os pontos da conversa vêm quando você encerrar.');
    }
  };
  setTimeout(
    () => {
      if (M === m && m.pronState === 'rec') m.stopper?.();
    },
    rec ? 5000 : 1500,
  );
}

/** Turnos feitos no cliente (modo demo, ajudas) que o /end acrescenta à sessão do servidor. */
function clientTurns(m: Session): ClientTurn[] {
  return m.turns.flatMap((t): ClientTurn[] => {
    if (t.who === 'coach' || !t.local || !t.en.trim()) return [];
    if (t.who === 'her') return [{ who: 'her', en: t.en, pt: t.pt, words: t.words }];
    return [{ who: 'me', en: t.en, fb: t.fb ?? null, pron: t.pron ?? [] }];
  });
}

/** finish(): fecha a sessão no servidor (ou guarda a local) e devolve o id do relatório. */
async function finish(c: Catalog, m: Session): Promise<string> {
  const secs = m.secStart ? Math.round((Date.now() - m.secStart) / 1000) : 0;
  const A = assistant(c);
  const local = (id: string): MicSession => ({
    id,
    at: m.secStart || Date.now(),
    assistant: A.k,
    mode: m.mode,
    mission: m.mode === 'missao' ? m.mission : null,
    extraId: m.mode === 'extra' ? m.extraId : null,
    secs,
    turns: m.turns.flatMap((t) =>
      t.who === 'coach'
        ? []
        : [
            t.who === 'her'
              ? { who: 'her' as const, en: t.en, pt: t.pt, fb: null, pron: [], words: t.words }
              : { who: 'me' as const, en: t.en, pt: '', fb: t.fb ?? null, pron: t.pron ?? [], words: [] },
          ],
    ),
    report: null,
  });
  if (m.id && !isLocalSession(m.id)) {
    const r = await endMicSession(m.id, clientTurns(m));
    if (r) {
      noteSessionAward(r.session.id, r.award);
      return r.session.id;
    }
    // Sem resposta: o relatório sai do que está na tela (modo demo), sem pontos confirmados.
    noteSessionAward(m.id, null);
    putSession(local(m.id));
    return m.id;
  }
  const sess = local(LOCAL_PREFIX + uid());
  putSession(sess);
  return sess.id;
}

async function mgEnd(): Promise<void> {
  const c = C();
  const m = M;
  if (!m || !c || m.stage !== 'call' || m.ending) return;
  hangup();
  m.ending = true;
  re();
  const id = await finish(c, m);
  if (M === m) M = null;
  go(`maggie/relatorio/${id}`);
}

/** leave(): sair no meio da conversa ainda guarda a sessão quando houve fala. */
function leave(): void {
  const c = C();
  const m = M;
  hangup();
  M = null;
  if (m && c && m.stage === 'call' && !m.ending && m.turns.length > 1) void finish(c, m);
}

// ---------- Render ----------

const minutesLeft = (m: Session): number =>
  Math.max(0, Math.round((S().maggie.secLeft - (Date.now() - m.secStart) / 1000) / 60));

/** Texto corrido no fundo navy: um pouco maior e mais claro que o .xs, para ler sem esforço. */
const READ = { color: '#DCE4F2', fontSize: '.875rem', lineHeight: '1.5' } as const;

// As partes da tela são funções de render, não componentes: a sessão M é mutada no lugar, e o
// @preact/signals pula o re-render de um componente que lê signals quando as props não mudam.
function MicStage(c: Catalog, m: Session) {
  const A = assistant(c);
  const on = m.stage === 'call';
  const last = lastHer(m);
  const talking = m.speaking;
  // Uma gravação do modo pronúncia também é escuta (av.listening(true) do mgPronRec do protótipo).
  const hearing = m.listening || m.pronState === 'rec';
  return (
    <Stage
      id="av-live"
      bg={catalogImage('bg/maggie-set')}
      status={on ? (hearing ? 'Ouvindo você' : m.busy ? 'Pensando' : 'Ao vivo') : A.full}
      listening={hearing}
    >
      {on && last ? (
        <div class="caption">
          <span class="en">{last.en}</span>
          {m.subsPt ? (
            <span class="ptl">
              <span>{last.pt}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      <AvatarVideo key={A.k} a={A} talking={talking} mood={m.mood} />
    </Stage>
  );
}

/**
 * C.assistPicker com as mesmas classes (.assist-row / .assist), em grade: as cinco opções sempre à
 * vista, sem cartão cortado na borda. No celular o cartão fica compacto (rosto menor, subtítulo em
 * letra menor); a grade iguala a altura dos cinco cartões.
 */
function AssistGrid(c: Catalog, cur: string, desk: boolean) {
  const size = desk ? 60 : 50;
  return (
    <div
      class="assist-row"
      role="radiogroup"
      aria-label="Seu assistente"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${c.assistants.length}, minmax(0, 1fr))`,
        gap: desk ? '10px' : '5px',
        overflow: 'visible',
        padding: '2px',
      }}
    >
      {c.assistants.map((a) => {
        const vid = !!a.thumb && !!a.clips && Object.values(a.clips).some(Boolean);
        return (
          // biome-ignore lint/a11y/useSemanticElements: o radiogroup de botões do protótipo; o tie.css estiliza .assist.
          <button
            type="button"
            key={a.k}
            class={`assist${a.k === cur ? ' on' : ''}`}
            role="radio"
            aria-checked={a.k === cur ? 'true' : 'false'}
            style={{ maxWidth: 'none', minWidth: '0', padding: desk ? '12px 8px 10px' : '10px 4px 9px' }}
            onClick={activator(undefined, () => mgPick(a.k))}
          >
            {vid ? (
              <img src={a.thumb ?? ''} alt="" style={{ width: `${size}px`, height: `${size}px` }} />
            ) : (
              <span class="av-ini" style={{ '--s': `${size}px` }}>
                {assistInitials(a)}
              </span>
            )}
            <b style={desk ? undefined : { fontSize: '.86rem' }}>{a.name}</b>
            {/* No celular o estilo do escolhido aparece por extenso logo abaixo da grade (AssistInfo). */}
            {desk ? <span style={{ display: 'block', minHeight: '2.4em' }}>{a.tag}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Lista de opções (cenas, Extras): duas colunas de largura igual, texto à esquerda, sem borda
 * serrilhada e sem pílula larga quase vazia. Cada linha da grade tem a altura do seu maior cartão, e
 * o texto começa no topo: os nomes de uma mesma linha ficam na mesma altura, quebrando ou não.
 */
const optGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '8px',
} as const;
const optChip = {
  width: '100%',
  minWidth: '0',
  justifyContent: 'flex-start',
  alignItems: 'flex-start',
  textAlign: 'left',
  borderRadius: '14px',
  padding: '12px',
  lineHeight: '1.25',
} as const;

/**
 * Chip do protótipo (.chip, aria-pressed, .ck). O sufixo ("· seu objetivo", "· visto") vira uma linha
 * própria sob o nome, com um ícone no lugar do ponto: o "·" continua no texto (leitores de tela,
 * copiar e colar) mas com tamanho zero, para nenhuma linha começar com um ponto solto.
 */
function OptChip(label: string, suffix: string, icon: string, on: boolean, pick: () => void, key: string) {
  const rest = suffix.replace(/^\s*·\s*/, '');
  return (
    <button
      type="button"
      key={key}
      class={`chip${on ? ' on' : ''}`}
      aria-pressed={on ? 'true' : 'false'}
      style={optChip}
      onClick={activator(undefined, pick)}
    >
      <span class="ck" style={{ marginTop: '1px' }}>
        {on ? <Icon name="check" size={12} /> : null}
      </span>
      <span style={{ minWidth: '0' }}>
        {label}
        {rest ? (
          <>
            {' '}
            <span
              style={{
                display: 'inline-block',
                width: '100%',
                marginTop: '3px',
                fontSize: '.78rem',
                fontWeight: '700',
                color: on ? 'var(--orange)' : '#FFD27A',
              }}
            >
              <Icon name={icon} size={12} extra={{ style: { verticalAlign: '-1px', marginRight: '5px' } }} />
              <span style={{ fontSize: '0' }}>· </span>
              {rest}
            </span>
          </>
        ) : null}
      </span>
    </button>
  );
}

function Lobby(c: Catalog, m: Session, desk: boolean) {
  const s = S();
  const p = s.profile;
  const A = assistant(c);
  const training = p ? defaults(p).training : false;
  const mine = p ? missions(p, c).map((x) => x.k) : [];
  let pickRow = null;
  if (m.mode === 'missao') {
    const order = mine.concat(c.mic.missions.map((x) => x.k).filter((k) => !mine.includes(k)));
    const cur = mission(c, m.mission);
    pickRow = (
      <div class="stack" style={{ '--gap': '8px' }}>
        <div class="lbl">Escolha a cena</div>
        <div class="chips" style={optGrid}>
          {order.map((k) => {
            const x = mission(c, k);
            return x && x.k === k
              ? OptChip(
                  x.t,
                  mine.includes(k) ? ' · seu objetivo' : '',
                  'target',
                  m.mission === k,
                  () => {
                    m.mission = k;
                    re();
                  },
                  k,
                )
              : null;
          })}
        </div>
        {cur ? (
          <div class="card" style={{ padding: '14px' }}>
            <div class="xs" style={READ}>
              {The(A)} faz o papel de {cur.role}.
            </div>
            <div class="h3 mt4" style={{ color: '#fff' }}>
              {cur.goal}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
  if (m.mode === 'extra')
    pickRow = (
      <div class="stack" style={{ '--gap': '8px' }}>
        <div class="lbl">Qual Extra você viu?</div>
        <div class="chips" style={optGrid}>
          {usableExtras(c, s).map((x) =>
            OptChip(
              x.title,
              s.extras.seen[x.id] ? ' · visto' : '',
              'eye',
              m.extraId === x.id,
              () => {
                m.extraId = x.id;
                re();
              },
              x.id,
            ),
          )}
        </div>
      </div>
    );
  if (m.mode === 'livre') {
    const ctx = p ? tutorContext(p, c) : null;
    pickRow = (
      <div class="xs" style={READ}>
        {The(A)} puxa assunto a partir do que você curte:{' '}
        {(ctx ? ctx.formats.concat(ctx.genres).slice(0, 5).join(', ') : '') || 'o seu dia'}.
      </div>
    );
  }
  if (m.mode === 'pronuncia')
    pickRow = (
      <div class="xs" style={READ}>
        Seis frases com os sons que mais travam quem fala português.
      </div>
    );
  const limitMin = Math.round((s.maggie.limitSec || 3600) / 60);
  const start = (
    <>
      {pickRow}
      <Btn label="Começar a conversa · +30 pontos" icon="mic" cls="block" onClick={() => void mgCall()} />
      {/* Os minutos numa linha só; o modo treino, quando ligado, na linha de baixo. */}
      <div class="stack" style={{ '--gap': '2px', alignItems: 'center', textAlign: 'center' }}>
        <span class="xs" style={{ ...READ, whiteSpace: 'nowrap' }}>
          <Icon
            name="clock"
            size={16}
            extra={{ style: { color: '#FFD27A', verticalAlign: '-3px', marginRight: '6px' } }}
          />
          {`${Math.round(s.maggie.secLeft / 60)} de ${limitMin} min restantes no mês`}
        </span>
        {training ? (
          <span class="xs" style={READ}>
            Modo treino, sem nota
          </span>
        ) : null}
      </div>
      {!speech.canListen ? (
        <div class="fb tip">
          Este navegador não reconhece fala. Você pode conversar digitando. Para falar, use o Chrome ou o Edge.
        </div>
      ) : null}
    </>
  );
  const setup = (
    <>
      <div class="stack" style={{ '--gap': '8px' }}>
        <div class="lbl">Seu assistente</div>
        {AssistGrid(c, A.k, desk)}
        {desk ? (
          <div class="xs" style={{ ...READ, paddingRight: '12px', textWrap: 'pretty' }}>
            <b style={{ color: '#fff' }}>{A.full}</b> · {A.role}. {A.style}
          </div>
        ) : (
          // No celular o estilo (a.tag) sai do cartão apertado e vira o selo do escolhido, ao lado do nome.
          <div class="stack" style={{ '--gap': '4px' }}>
            <div class="row wrapx" style={{ '--gap': '8px' }}>
              <b style={{ color: '#fff', fontSize: '.95rem' }}>{A.full}</b>
              <span class="pill" style={{ background: 'var(--navy3)', color: '#FFD27A' }}>
                {A.tag}
              </span>
            </div>
            <div class="xs" style={{ ...READ, textWrap: 'pretty' }}>
              {A.role}. {A.style}
            </div>
          </div>
        )}
      </div>
      <div class="modes">
        {c.mic.modes.map((x) => (
          <button
            type="button"
            key={x.k}
            class={`mode${m.mode === x.k ? ' on' : ''}`}
            aria-pressed={m.mode === x.k ? 'true' : 'false'}
            onClick={activator(undefined, () => setMode(x.k))}
          >
            <Icon name={x.icon} size={22} extra={{ style: { color: '#FFD27A' } }} />
            <span class="h3">{x.t}</span>
            <span class="xs" style={READ}>
              {x.s}
            </span>
          </button>
        ))}
      </div>
    </>
  );
  // No desktop a cena e o botão de começar vão para o topo da coluna da direita (à vista sem rolar),
  // e as frases de socorro ficam sob os modos, para as duas colunas terem a mesma altura.
  return {
    setup: (
      <div class="stack" style={{ '--gap': '16px', ...(desk ? { flex: '1 0 auto' } : {}) }}>
        {setup}
        {desk ? HelpCard(c) : start}
      </div>
    ),
    start: desk ? (
      <div class="stack" style={{ '--gap': '14px', padding: '18px 16px 4px' }}>
        {start}
      </div>
    ) : null,
  };
}

function FbChips(t: Extract<Turn, { who: 'me' }>) {
  const f = t.fb;
  if (!f) return null;
  const head =
    f.status === 'certo' ? (
      <>
        <Icon name="check" size={18} />
        <span>
          <b>Certo.</b> {f.explain_pt || ''}
        </span>
      </>
    ) : f.status === 'ajuste' ? (
      <>
        <Icon name="pen" size={18} />
        <span>
          <b>Ajuste</b>
          {f.corrected ? <span class="fix-line">{f.corrected}</span> : null}
          {f.explain_pt || ''}
          {f.tip_pt ? ` ${f.tip_pt}` : ''}
        </span>
      </>
    ) : (
      <>
        <Icon name="bulb" size={18} />
        <span>
          <b>Mais natural</b>
          {f.corrected ? <span class="fix-line">{f.corrected}</span> : null}
          {f.explain_pt || ''}
        </span>
      </>
    );
  return (
    <div class="fbrow">
      <div class={`fbchip ${f.status}`}>{head}</div>
      {(t.pron || []).map((p) => (
        <div key={p.word} class="fbchip natural">
          <Icon name="wave" size={18} />
          <span>
            <b>{p.word}</b> · {p.tip_pt}
          </span>
        </div>
      ))}
    </div>
  );
}

function Transcript(c: Catalog, m: Session) {
  const A = assistant(c);
  return (
    <div class="transcript" id="mg-tr">
      {m.turns.map((t, i) => {
        if (t.who === 'coach')
          return (
            <div key={i} class="card paper" style={{ alignSelf: 'stretch' }}>
              <div class="lbl or">Coach · em português</div>
              <p class="p mt4">
                {The(A)} disse: <b>{t.said}</b>
                <br />
                Você pode responder: <b>{t.hintEn}</b> <span class="sm">({t.hintPt})</span>
              </p>
            </div>
          );
        if (t.who === 'her')
          return (
            <div key={i} class="bub her">
              <div class="en">{t.en}</div>
              {m.subsPt ? <div class="pt">{t.pt}</div> : null}
              {t.words.length ? (
                <div class="row wrapx mt8" style={{ '--gap': '6px' }}>
                  {t.words.map((w) => (
                    <button
                      type="button"
                      key={w.en}
                      class="pill bl"
                      onClick={activator(undefined, () => void mgWord(i, w.en))}
                    >
                      <Icon name="plus" size={12} />
                      {w.en} · {w.pt}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        return MeTurn(t, i);
      })}
      {m.listening ? (
        <div class="bub me interim">
          <div class="en" id="mg-interim">
            {m.interim || 'Ouvindo…'}
          </div>
        </div>
      ) : null}
      {m.busy ? (
        <div class="thinking">
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {m.ended ? (
        <div class="card paper stack pop" style={{ '--gap': '10px', alignSelf: 'stretch' }}>
          <div class="lbl or">A cena terminou</div>
          <div class="h3">Veja o que foi bem e o que ajustar.</div>
          <Btn label="Ver o relatório" icon="star" cls="block" onClick={() => void mgEnd()} />
        </div>
      ) : null}
    </div>
  );
}

function MeTurn(t: Extract<Turn, { who: 'me' }>, key: number) {
  return (
    <Fragment key={key}>
      <div class="bub me">
        <div class="en">{t.en}</div>
      </div>
      {FbChips(t)}
    </Fragment>
  );
}

function Dock(c: Catalog, m: Session) {
  const hint = m.last?.hint_en;
  const off = m.busy || m.ended;
  return (
    <div class="dock">
      <div class="help">
        {c.mic.help.map((h) => (
          <button type="button" key={h.en} onClick={activator(undefined, () => mgHelp(h.en))}>
            {h.en} <small>{h.pt}</small>
          </button>
        ))}
        <button type="button" onClick={activator(undefined, () => void mgCoach())}>
          <Icon name="book" size={16} /> Me explica em português
        </button>
        {hint ? (
          <button type="button" onClick={activator(undefined, mgHint)}>
            <Icon name="bulb" size={16} /> Dica
          </button>
        ) : null}
        <button type="button" onClick={activator(undefined, mgSubs)}>
          <Icon name="cc" size={16} />
          {m.subsPt ? ' Esconder PT' : ' Mostrar PT'}
        </button>
        <button type="button" onClick={activator(undefined, mgHands)}>
          <Icon name="mic" size={16} />
          {m.hands ? ' Mãos livres: sim' : ' Mãos livres: não'}
        </button>
      </div>
      <div class="say">
        <input
          class="input"
          id="mg-input"
          aria-label="Sua resposta em inglês"
          placeholder={speech.canListen ? 'Fale no microfone ou digite' : 'Digite a sua resposta em inglês'}
          autocomplete="off"
          value={m.typed}
          disabled={off}
          onInput={(e) => {
            m.typed = (e.currentTarget as HTMLInputElement).value;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              mgSend();
            }
          }}
        />
        <button
          type="button"
          class="iconbtn"
          aria-label="Enviar"
          style={{ width: '52px', height: '52px' }}
          onClick={activator(undefined, mgSend)}
        >
          <Icon name="send" size={22} />
        </button>
        <button
          type="button"
          class={`mic${m.listening ? ' rec' : ''}`}
          aria-label={m.listening ? 'Parar' : 'Falar'}
          disabled={off}
          style={off ? { opacity: '.5' } : undefined}
          onClick={activator(undefined, mgMic)}
        >
          <Icon name={m.listening ? 'stop' : 'mic'} size={28} />
        </button>
      </div>
    </div>
  );
}

function PronPanel(c: Catalog, m: Session) {
  const list = c.mic.pron;
  const it = list[m.pronIdx];
  const r = m.pronRes;
  const p = S().profile;
  const training = p ? defaults(p).training : false;
  const A = assistant(c);
  if (!it) return null;
  const lastOne = m.pronIdx >= list.length - 1;
  return (
    <div class="stack" style={{ '--gap': '14px', padding: '16px' }}>
      <div class="card paper stack tc" style={{ '--gap': '12px', alignItems: 'center' }}>
        <div class="lbl">{`Frase ${m.pronIdx + 1} de ${list.length}`}</div>
        <div class="h1">{it.en}</div>
        <div class="fb tip" style={{ textAlign: 'left', width: '100%' }}>
          <b>Dica {of(A)}:</b> {it.tip}
        </div>
        <div class="row center" style={{ '--gap': '10px' }}>
          <Btn label="Ouvir" kind="ghost compact" icon="speaker" onClick={mgPronHear} />
          <button
            type="button"
            class={`mic${m.pronState === 'rec' ? ' rec' : ''}`}
            aria-label="Gravar"
            onClick={activator(undefined, () => void mgPronRec())}
          >
            <Icon name={m.pronState === 'rec' ? 'stop' : 'mic'} size={28} />
          </button>
        </div>
        <div class="sm" style={{ fontWeight: '700' }}>
          {m.pronState === 'rec'
            ? 'Ouvindo… toque para parar'
            : m.pronState === 'busy'
              ? `${The(A)} está ouvindo…`
              : 'Toque no microfone e diga a frase'}
        </div>
        {r ? (
          <div class="stack pop" style={{ '--gap': '10px', width: '100%' }}>
            {training ? null : (
              <div class="row center base" style={{ '--gap': '4px' }}>
                <span class="num" style={{ fontSize: '3rem' }}>
                  {r.score}
                </span>
                <span class="h3 muted">/10</span>
              </div>
            )}
            <div class={`fb ${r.score >= 8 ? 'ok' : 'fix'}`} style={{ textAlign: 'left' }}>
              <b>{r.praise_pt}</b>
              {r.heard ? (
                <>
                  <br />
                  <span class="sm">Entendi: “{r.heard}”</span>
                </>
              ) : null}
              {(r.issues || []).map((x) => (
                <Fragment key={x.word}>
                  <br />
                  <b>{x.word}:</b> {x.issue_pt ? `${x.issue_pt} ` : ''}
                  {x.tip_pt}
                </Fragment>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div class="row" style={{ '--gap': '10px' }}>
        <Btn label="Anterior" kind="ghost compact" cls="grow" onClick={() => mgPronNav(-1)} />
        <Btn
          label={lastOne ? 'Encerrar' : 'Próxima frase'}
          kind="compact"
          cls="grow"
          onClick={() => (lastOne ? void mgEnd() : mgPronNav(1))}
        />
      </div>
    </div>
  );
}

const HOW = (c: Catalog) => {
  const A = assistant(c);
  return [
    `${The(A)} fala em inglês, no seu nível. A legenda em português pode ficar ligada.`,
    'Responda falando no microfone ou digitando.',
    'Cada fala sua recebe retorno: certo, ajuste (em azul) ou mais natural.',
    'No fim, o relatório mostra o que foi bem, o que ajustar e as palavras novas.',
  ];
};

const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

const rowBtn = {
  width: '100%',
  textAlign: 'left',
  padding: '10px 12px',
  borderRadius: '12px',
  background: 'var(--navyD)',
  border: '1.5px solid var(--navy3)',
  color: '#fff',
} as const;

/**
 * As frases de socorro da conversa (desktop, sob os modos): toque para ouvir. É o último cartão da
 * coluna da esquerda e estica até o fim dela, como o último da direita: as duas terminam juntas.
 */
function HelpCard(c: Catalog) {
  return (
    <div class="card stack" style={{ '--gap': '12px', flex: '1 0 auto' }}>
      {/* Título e instrução na mesma linha: o cartão fica baixo e as colunas terminam juntas. */}
      <div class="row base wrapx" style={{ '--gap': '6px 12px', justifyContent: 'space-between' }}>
        <div class="h3" style={{ color: '#fff' }}>
          Se travar, é só pedir
        </div>
        <span class="xs" style={READ}>
          Toque para ouvir. Na conversa, ficam sob a resposta.
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(3, c.mic.help.length)}, minmax(0, 1fr))`,
          gap: '8px',
        }}
      >
        {c.mic.help.map((h) => (
          <button
            type="button"
            key={h.en}
            class="row top"
            style={{ ...rowBtn, '--gap': '10px' }}
            onClick={activator(undefined, () => void maggieSays(h.en, { rate: 0.85 }))}
          >
            <Icon name="speaker" size={18} extra={{ style: { color: '#FFD27A', flex: 'none', marginTop: '2px' } }} />
            <span class="stack" style={{ '--gap': '2px', minWidth: '0' }}>
              <b style={{ fontSize: '.95rem' }}>{h.en}</b>
              <span class="xs" style={READ}>
                {h.pt}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Coluna da direita no lobby (desktop): a cena e o botão de começar, como funciona e as últimas conversas. */
function LobbyAside(c: Catalog, start: ComponentChildren) {
  const A = assistant(c);
  // Uma conversa que o servidor fechou sozinho, sem nenhuma fala sua e sem relatório, não é histórico.
  const kept = S().maggie.sessions.filter((x) => !!x.report || x.turns.some((t) => t.who === 'me'));
  const sessions = kept.slice(0, 4);
  const totalMin = Math.round(kept.reduce((n, x) => n + x.secs, 0) / 60);
  const totalMine = kept.reduce((n, x) => n + x.turns.filter((t) => t.who === 'me').length, 0);
  const totals: [number, string, string][] = [
    [kept.length, 'conversa guardada', 'conversas guardadas'],
    [totalMin, 'minuto de conversa', 'minutos de conversa'],
    [totalMine, 'fala sua', 'falas suas'],
  ];
  return (
    <div style={{ flex: '1', minHeight: '0', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {start}
      {/* Os passos em ritmo fixo, cada um com o número num círculo, sem esticar o cartão. */}
      <div class="transcript" style={{ flex: 'none', overflow: 'visible', paddingBottom: '0' }}>
        <div class="card stack" style={{ '--gap': '14px' }}>
          <div class="h3" style={{ color: '#fff' }}>
            Como funciona
          </div>
          <ol class="stack" style={{ '--gap': '16px', margin: '0', padding: '0', listStyle: 'none' }}>
            {HOW(c).map((t, i) => (
              <li key={t} class="row top" style={{ '--gap': '12px' }}>
                <span
                  class="num"
                  aria-hidden="true"
                  style={{
                    width: '26px',
                    height: '26px',
                    flex: 'none',
                    borderRadius: '50%',
                    background: 'var(--orange)',
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: '800',
                    fontSize: '.85rem',
                  }}
                >
                  {i + 1}
                </span>
                <span class="sm" style={{ color: '#fff', paddingTop: '3px' }}>
                  {t}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div class="stack" style={{ '--gap': '12px', padding: '12px 16px 18px', flex: '1 0 auto' }}>
        {/* Último cartão da coluna: termina junto com a coluna da esquerda, os totais no pé. */}
        <div class="card stack" style={{ '--gap': '10px', flex: '1 0 auto' }}>
          <div class="h3" style={{ color: '#fff' }}>
            Suas últimas conversas
          </div>
          {sessions.length ? (
            sessions.map((x) => {
              const mineN = x.turns.filter((t) => t.who === 'me').length;
              return (
                <button
                  type="button"
                  key={x.id}
                  class="row"
                  style={{ ...rowBtn, '--gap': '12px' }}
                  onClick={activator(undefined, () => go(`maggie/relatorio/${x.id}`))}
                >
                  <Icon name="chat" size={20} extra={{ style: { color: '#FFD27A', flex: 'none' } }} />
                  <span class="stack grow" style={{ '--gap': '2px', minWidth: '0', flex: '1' }}>
                    <b style={{ fontSize: '.95rem' }}>{sessionTitle(c, x.mode, x.mission)}</b>
                    <span class="xs" style={READ}>
                      {`${dayFmt.format(x.at).replace('.', '')} · ${assistant(c, x.assistant).name} · ${fmt(x.secs)} · ${mineN} ${mineN === 1 ? 'fala sua' : 'falas suas'}`}
                    </span>
                  </span>
                  <span class="xs" style={{ ...READ, color: '#FFD27A', fontWeight: '800', flex: 'none' }}>
                    Relatório
                  </span>
                  <Icon name="next" size={16} extra={{ style: { color: '#FFD27A', flex: 'none' } }} />
                </button>
              );
            })
          ) : (
            <div class="xs" style={READ}>
              {`Quando você terminar a primeira conversa com ${the(A)}, o relatório fica guardado aqui.`}
            </div>
          )}
          {sessions.length ? (
            // O total do que ficou guardado, no pé do cartão.
            <div
              style={{
                marginTop: 'auto',
                paddingTop: '2px',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '8px',
              }}
            >
              {totals.map(([n, one, many]) => (
                <div
                  key={many}
                  class="stack"
                  style={{ ...rowBtn, '--gap': '2px', padding: '10px 12px', background: 'transparent' }}
                >
                  <span class="num" style={{ color: '#fff', fontSize: '1.5rem' }}>
                    {n}
                  </span>
                  <span class="xs" style={READ}>
                    {n === 1 ? one : many}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function Maggie({ q }: ScreenProps) {
  const [, setTick] = useState(0);
  const c = catalog.value;
  const s = state.value;
  rerender = () => setTick((n) => n + 1);

  // A sessão nasce do link (#/maggie?modo=missao&m=viagem) e é refeita quando ele muda no lobby.
  if (c && (!M || (M.stage === 'lobby' && (q.modo || q.m || q.x) && M.q !== JSON.stringify(q)))) {
    hangup();
    M = newSession(c, q);
  }
  const m = M;
  const inCall = m?.stage === 'call';
  useChrome({ theme: 'navy', tabs: !inCall, nav: 'maggie', title: 'Mic' });

  useEffect(() => {
    if (!catalog.value) void loadCatalog().catch(() => {});
    return () => {
      leave();
      rerender = () => {};
    };
  }, []);

  // O relógio do topo (minutos restantes) anda a cada 15 s durante a conversa.
  useEffect(() => {
    if (!inCall) return;
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [inCall]);

  // Na conversa, a última fala fica à vista.
  useLayoutEffect(() => {
    if (M?.stage !== 'call') return;
    const sc = document.getElementById('mg-scroll') || document.getElementById('mg-tr');
    if (sc) sc.scrollTop = sc.scrollHeight;
  });

  if (!c || !m)
    return <div class="live on-navy" style={{ flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' }} />;

  const A = assistant(c);
  const desk = layoutOf(s) === 'desktop';
  const top = (
    <header class="topbar">
      <button
        type="button"
        class="iconbtn"
        aria-label={inCall ? 'Encerrar' : 'Voltar'}
        onClick={activator(undefined, inCall ? () => void mgEnd() : mgBack)}
      >
        <Icon name={inCall ? 'close' : 'back'} size={20} />
      </button>
      <div class="ttl">
        <div class="lbl">
          {inCall
            ? m.mode === 'missao'
              ? `Missão · ${mission(c, m.mission)?.t ?? ''}`
              : (modeCard(c, m.mode)?.t ?? '')
            : 'Conversa em tempo real'}
        </div>
        {inCall || desk ? (
          <div class="h2" style={{ color: '#fff', marginTop: '2px' }}>
            {A.name}
          </div>
        ) : (
          // No celular o selo vai para a direita, na linha do nome: o rótulo de cima fica numa linha só.
          <div class="row" style={{ '--gap': '10px', marginTop: '2px', justifyContent: 'space-between' }}>
            <div class="h2" style={{ color: '#fff' }}>
              {A.name}
            </div>
            <AiBadge />
          </div>
        )}
      </div>
      {inCall ? (
        <>
          <span class="pill" style={{ background: 'var(--navy2)', color: '#FFD27A' }}>
            {`${minutesLeft(m)} min`}
          </span>
          <Btn label="Encerrar" kind="compact" onClick={() => void mgEnd()} />
        </>
      ) : desk ? (
        <AiBadge />
      ) : null}
    </header>
  );
  const talk =
    m.mode === 'pronuncia' ? (
      PronPanel(c, m)
    ) : (
      <>
        {Transcript(c, m)}
        {Dock(c, m)}
      </>
    );
  const lobby = inCall ? null : Lobby(c, m, desk);
  const body = desk ? (
    <div class="live-grid">
      <div class="left stack" style={{ '--gap': '16px' }}>
        {MicStage(c, m)}
        {inCall ? (
          <div class="xs">
            A legenda mostra a última fala {of(A)}. Toque nas palavras azuis para levar para a Revisão.
          </div>
        ) : (
          lobby?.setup
        )}
      </div>
      <div class="right">{inCall ? talk : LobbyAside(c, lobby?.start)}</div>
    </div>
  ) : (
    <>
      <div style={{ padding: '0 16px 12px' }}>{MicStage(c, m)}</div>
      {inCall ? talk : <div class="wrap">{lobby?.setup}</div>}
    </>
  );
  return (
    <div class="live on-navy" style={{ flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' }}>
      {top}
      {desk ? (
        body
      ) : (
        <div class="scroll" id="mg-scroll">
          {body}
        </div>
      )}
    </div>
  );
}
