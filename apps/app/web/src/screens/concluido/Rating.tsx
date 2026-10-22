// "Como foi este episódio?" (spec 07, feature C: NPS per episode). A PROD addition on the Concluído
// celebration: five large stars (native radios in an ARIA radiogroup, so arrows, Tab and Space work),
// then an optional comment (≤ 1000 characters, with a counter) and "Enviar avaliação". After sending,
// a thank-you card shows the rating, editable later; a rating sent offline is kept and queued.
import { LIMITS } from '@tie/shared/constants';
import { Btn, Icon } from '@tie/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { state } from '../../store';
import { rateEpisode } from '../../store/feedback';

/** What each star means, read beside the stars (and by screen readers). */
export const STAR_WORD = ['', 'Não gostei', 'Podia ser melhor', 'Foi ok', 'Gostei', 'Amei!'] as const;

const STAR_PATH = 'm12 3.5 2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9L3.4 9.8l6-.8z';

function Star({ size }: { size: number }) {
  return (
    <svg class="cc-star-svg" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={STAR_PATH} />
    </svg>
  );
}

/** Read-only stars (the saved rating). */
function StarsShown({ stars }: { stars: number }) {
  return (
    <span class="cc-stars-ro" role="img" aria-label={`${stars} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} class={n <= stars ? 'on' : ''}>
          <Star size={22} />
        </span>
      ))}
    </span>
  );
}

type Sent = 'sent' | 'queued' | null;

export function Rating({ ep }: { ep: number }) {
  const saved = state.value.feedback[String(ep)];
  const [editing, setEditing] = useState(!saved);
  const [pick, setPick] = useState(saved?.stars ?? 0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState(saved?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<'done' | 'form' | null>(null);
  const name = `cc-rate-${ep}`;

  // Focus follows the step: the thank-you heading after sending, the chosen star when editing.
  useEffect(() => {
    if (focusNext.current === 'done') doneRef.current?.focus();
    if (focusNext.current === 'form') formRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    focusNext.current = null;
  }, [editing]);

  const submit = async () => {
    if (!pick || busy) return;
    setBusy(true);
    const r = await rateEpisode(ep, pick, text);
    setBusy(false);
    if (r === 'failed') return;
    setSent(r);
    focusNext.current = 'done';
    setEditing(false);
  };

  const edit = () => {
    const cur = state.value.feedback[String(ep)];
    setPick(cur?.stars ?? pick);
    setText(cur?.comment ?? '');
    setSent(null);
    focusNext.current = 'form';
    setEditing(true);
  };

  if (!editing && saved) {
    return (
      <section class="card cc-rate cc-rate-done" aria-labelledby={`${name}-h`}>
        <div class="cc-rate-hd">
          <span class={`cc-rate-ic${sent ? ' ok' : ''}`} aria-hidden="true">
            <Icon name={sent ? 'check' : 'star'} size={20} />
          </span>
          <div class="cc-rate-t">
            <h2 class="h3" id={`${name}-h`} tabIndex={-1} ref={doneRef}>
              {sent ? 'Obrigado pela avaliação!' : 'Sua avaliação deste episódio'}
            </h2>
            <p class="xs" role={sent ? 'status' : undefined}>
              {sent === 'queued'
                ? 'Você está sem conexão: ela segue assim que a internet voltar.'
                : sent
                  ? 'Ela ajuda a gente a deixar o curso cada vez melhor.'
                  : 'Mudou de ideia? Dá para editar quando quiser.'}
            </p>
          </div>
        </div>
        <div class="cc-rate-sum">
          <StarsShown stars={saved.stars} />
          <span class="cc-rate-word">{STAR_WORD[saved.stars]}</span>
        </div>
        {saved.comment ? <p class="cc-rate-q">{saved.comment}</p> : null}
        <div class="cc-rate-act">
          <Btn label="Editar avaliação" kind="light compact" icon="pen" onClick={edit} />
        </div>
      </section>
    );
  }

  const shown = hover || pick;
  const left = LIMITS.feedbackCommentMax - text.length;
  return (
    <section class="card cc-rate" aria-labelledby={`${name}-h`}>
      <div class="cc-rate-hd">
        <span class="cc-rate-ic" aria-hidden="true">
          <Icon name="star" size={20} />
        </span>
        <div class="cc-rate-t">
          <h2 class="h3" id={`${name}-h`}>
            Como foi este episódio?
          </h2>
          <p class="xs" id={`${name}-d`}>
            Sua nota ajuda a gente a melhorar o curso.
          </p>
        </div>
      </div>
      <div ref={formRef} class="cc-rate-body">
        <div
          class="cc-stars"
          role="radiogroup"
          aria-labelledby={`${name}-h`}
          aria-describedby={`${name}-d`}
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} class={`cc-star${n <= shown ? ' on' : ''}${hover && n <= hover ? ' hov' : ''}`}>
              <input
                class="sr cc-star-in"
                type="radio"
                id={`${name}-${n}`}
                name={name}
                value={String(n)}
                checked={pick === n}
                onChange={() => {
                  // A keyboard change wins over a stale mouse hover preview.
                  setPick(n);
                  setHover(0);
                }}
              />
              <label for={`${name}-${n}`} onMouseEnter={() => setHover(n)}>
                <Star size={38} />
                <span class="sr">{`${n} ${n === 1 ? 'estrela' : 'estrelas'}: ${STAR_WORD[n]}`}</span>
              </label>
            </span>
          ))}
        </div>
        <div class={`cc-rate-word${shown ? '' : ' empty'}`} aria-hidden="true">
          {shown ? STAR_WORD[shown] : 'Toque nas estrelas'}
        </div>
        {pick ? (
          <div class="cc-rate-more">
            <label class="cc-rate-cl" for={`${name}-c`}>
              Quer contar mais? <span class="cc-rate-opt">opcional</span>
            </label>
            <textarea
              id={`${name}-c`}
              class="input cc-rate-ta"
              rows={3}
              maxLength={LIMITS.feedbackCommentMax}
              placeholder="O que você mais gostou, ou o que podemos melhorar?"
              aria-describedby={`${name}-n`}
              value={text}
              onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
            />
            <div class={`xs cc-rate-n${left <= 100 ? ' low' : ''}`} id={`${name}-n`}>
              {`${text.length}/${LIMITS.feedbackCommentMax}`}
              <span class="sr">{left === 1 ? ' (resta 1 caractere)' : ` (restam ${left} caracteres)`}</span>
            </div>
            <div class="cc-rate-act">
              <Btn
                label={busy ? 'Enviando…' : 'Enviar avaliação'}
                cls="block"
                icon={busy ? undefined : 'send'}
                dis={busy}
                onClick={() => void submit()}
              />
              {saved ? (
                <Btn
                  label="Cancelar"
                  kind="link"
                  onClick={() => {
                    setSent(null);
                    setHover(0);
                    focusNext.current = 'done';
                    setEditing(false);
                  }}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
