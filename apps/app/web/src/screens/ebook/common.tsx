// Shared bits of the e-book screens (hub and parts): the e-book file, its derived labels and copy.
import type { Catalog, Ebook, TestQuestion } from '@tie/shared/content/schema';
import { norm } from '@tie/shared/domain/norm';
import type { TestAnswer } from '@tie/shared/state';
import { activator, Icon, Topbar } from '@tie/ui';
import type { ComponentChildren } from 'preact';
import { layoutOf } from '../../shell';
import { loadEbook, state, useContent } from '../../store';

/** The only e-book with screens (ROUTES: #/ebook/1 and #/ebook/1/:part). */
export const EB = 1;

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** TIE.u.sub: replaces {N} with the learner's name. */
export const sub = (t: string | undefined, name: string | undefined): string =>
  String(t || '')
    .split('{N}')
    .join(name || '');

/** ebook/1.json, shared with every screen that asked for it. */
export function useEbook() {
  return useContent<Ebook>(() => loadEbook(EB), []);
}

/** "Lições 1 e 2" from the e-book's episodes. */
export function lessonsLabel(eb: Pick<Ebook, 'episodes'>): string {
  const eps = eb.episodes;
  if (eps.length <= 1) return `Lição ${eps[0] ?? ''}`;
  return `Lições ${eps.slice(0, -1).join(', ')} e ${eps[eps.length - 1]}`;
}

/** Season of the e-book's first episode (1 when unknown). */
export function ebookSeason(c: Catalog | null, eb: Pick<Ebook, 'episodes'>): number {
  const first = eb.episodes[0];
  return c?.episodes.find((x) => x.num === first)?.season ?? 1;
}

/** CEFR of a season, from the level list (season 1 → A1). */
export function seasonCefr(c: Catalog | null, season: number): string {
  return c?.onboarding.levels.find((l) => l.season === season)?.cefr ?? 'A1';
}

/** All the test's questions, in order. */
export const allQuestions = (eb: Pick<Ebook, 'test'>): TestQuestion[] => eb.test.flatMap((p) => p.qs);

/** "20 questões sobre as Lições 1 e 2. Nota de corte: 70%, ou 14 acertos. Recomenda, não bloqueia." */
export function testIntro(eb: Ebook): string {
  const total = allQuestions(eb).length;
  const pct = total ? Math.round((eb.passScore / total) * 100) : 0;
  return `${total} questões sobre as ${lessonsLabel(eb)}. Nota de corte: ${pct}%, ou ${eb.passScore} acertos. Recomenda, não bloqueia.`;
}

/** The prototype's isRight(q) (the server grades the same way; this only drives the review list). */
export function isRight(q: TestQuestion, v: TestAnswer | undefined): boolean {
  if (q.opts) return v === q.a;
  return !!q.acc?.includes(norm(v));
}

/** Answered the prototype's way: a choice, or non-blank text. */
export function isAnswered(q: TestQuestion, v: TestAnswer | undefined): boolean {
  return q.opts ? v != null : !!(v != null && String(v).trim());
}

/** The content file could not load (offline, unpublished): the screen says so instead of a blank. */
export function LoadFailed({ back, kicker, title }: { back: string; kicker: string; title: string }) {
  return (
    <>
      <Topbar back={back} kicker={kicker} title={title} />
      <div class="scroll">
        <div class="wrap stack" style={{ '--wrap': '760px', '--gap': '14px' }}>
          <div class="card stack" style={{ '--gap': '8px' }}>
            <div class="h3">Não deu para abrir este e-book agora.</div>
            <p class="p">Confira a internet e tente de novo.</p>
          </div>
        </div>
      </div>
    </>
  );
}

/** True on the desktop layout (side nav + wide main). */
export const isDesk = (): boolean => layoutOf(state.value) === 'desktop';

/** Content width of the e-book screens on desktop (the side nav takes the rest). */
export const DESK_WRAP = '1040px';

/**
 * Desktop page head, inside the content column so it lines up with the cards below it (the mobile
 * Topbar spans the whole main, which on desktop left the title far from the centred column).
 */
export function DeskHead({
  back,
  kicker,
  title,
  intro,
}: {
  back: string;
  kicker: string;
  title: string;
  intro?: string;
}) {
  // The intro belongs to the head: it sits under the title, on the title's left edge, so the back
  // button, the title and the intro read as one block over the content.
  return (
    <div class="row top" style={{ '--gap': '14px' }}>
      <button type="button" class="iconbtn" aria-label="Voltar" onClick={activator(back, undefined)}>
        <Icon name="back" size={20} />
      </button>
      <div style={{ minWidth: '0', alignSelf: intro ? 'flex-start' : 'center' }}>
        <div class="lbl">{kicker}</div>
        <h1 class="h1 mt4">{title}</h1>
        {intro ? (
          <p class="p-read mt8" style={{ maxWidth: '62ch' }}>
            {intro}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** head(kick, title, ptl) + end of the e-book part screens. */
export function PartFrame({
  kick,
  title,
  intro,
  children,
}: {
  kick: string;
  title: string;
  intro?: string;
  children?: ComponentChildren;
}) {
  const desk = isDesk();
  const kicker = `E-book ${pad2(EB)} · ${kick}`;
  return (
    <>
      {desk ? null : <Topbar back={`ebook/${EB}`} kicker={kicker} title={title} />}
      <div class="scroll">
        <div class="wrap stack" style={{ '--wrap': desk ? DESK_WRAP : '760px', '--gap': '14px' }}>
          {desk ? <DeskHead back={`ebook/${EB}`} kicker={kicker} title={title} intro={intro} /> : null}
          {intro && !desk ? <p class="p-read">{intro}</p> : null}
          {children}
        </div>
      </div>
    </>
  );
}
