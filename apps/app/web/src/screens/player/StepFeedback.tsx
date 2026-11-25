import { LIMITS } from '@tie/shared/constants';
import type { StepFeedbackBody } from '@tie/shared/contracts/feedback';
import { Icon, toast } from '@tie/ui';
import { useRef, useState } from 'preact/hooks';
import { errorMessage, newIdempotencyKey } from '../../api';
import { Overlay } from '../../frame';
import { SHEET_FOCUS, useModal } from '../entrada/legal';

export function StepFeedback({
  episodeNum,
  step,
  stepName,
  save,
  onContinue,
  onCancel,
}: {
  episodeNum: number;
  step: number;
  stepName: string;
  save: (id: string, body: StepFeedbackBody) => Promise<'sent' | 'queued'>;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [hadDifficulty, setHadDifficulty] = useState<boolean | null>(null);
  const [difficulty, setDifficulty] = useState('');
  const [improvement, setImprovement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const id = useRef(newIdempotencyKey());
  const cancel = () => {
    if (!sending.current) onCancel();
  };
  const ref = useModal(cancel);
  const submit = async () => {
    if (!stars || hadDifficulty == null || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await save(id.current, {
        episodeNum,
        step,
        stars,
        hadDifficulty,
        difficulty: hadDifficulty ? difficulty.trim() || null : null,
        improvement: improvement.trim() || null,
      });
      if (result === 'queued') toast('Feedback salvo no aparelho. Será enviado quando a conexão voltar.');
      onContinue();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <Overlay>
      <div class="overlay">
        <div class="scrim" aria-hidden="true" />
        <div
          class="sheet pl-feedback"
          role="dialog"
          aria-modal="true"
          aria-labelledby="step-fb-title"
          aria-describedby="step-fb-desc"
          tabIndex={-1}
          ref={ref}
          style={SHEET_FOCUS}
        >
          <div class="grab" />
          <div class="row between top">
            <div>
              <div class="lbl">{`Episódio ${episodeNum} · etapa ${step} · ${stepName}`}</div>
              <h2 class="h2 mt8" id="step-fb-title">
                Como foi sua experiência?
              </h2>
            </div>
            <button type="button" class="iconbtn" aria-label="Voltar à etapa" onClick={cancel} disabled={busy}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <p class="sm mt8" id="step-fb-desc">
            Antes de continuar, conte como foi usar a plataforma nesta etapa. Sua opinião ajuda a melhorar as telas e os
            recursos.
          </p>
          <form
            class="stack mt16"
            style={{ '--gap': '16px' }}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset class="pl-fb-field" disabled={busy}>
              <legend class="h3">Como foi usar esta tela?</legend>
              <div class="pl-fb-stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} class={stars === n ? 'on' : ''}>
                    <input
                      type="radio"
                      name="experience"
                      value={n}
                      checked={stars === n}
                      required
                      onChange={() => setStars(n)}
                    />
                    <span aria-hidden="true">★</span>
                    <span class="pl-sr">{`${n} de 5 estrelas`}</span>
                  </label>
                ))}
              </div>
              <p class="xs">1 = muito ruim · 5 = muito boa</p>
            </fieldset>
            <fieldset class="pl-fb-field" disabled={busy}>
              <legend class="h3">Você sentiu alguma dificuldade?</legend>
              <div class="row mt8" style={{ '--gap': '20px' }}>
                {[false, true].map((value) => (
                  <label key={String(value)} class="row" style={{ '--gap': '8px' }}>
                    <input
                      type="radio"
                      name="difficulty"
                      checked={hadDifficulty === value}
                      required
                      onChange={() => setHadDifficulty(value)}
                    />
                    {value ? 'Sim' : 'Não'}
                  </label>
                ))}
              </div>
            </fieldset>
            {hadDifficulty ? (
              <label class="stack" style={{ '--gap': '6px' }}>
                <span class="h3">
                  O que dificultou? <span class="xs">(opcional)</span>
                </span>
                <textarea
                  class="input"
                  rows={2}
                  maxLength={LIMITS.feedbackCommentMax}
                  value={difficulty}
                  disabled={busy}
                  onInput={(e) => setDifficulty(e.currentTarget.value)}
                  placeholder="Ex.: não encontrei um botão ou o áudio não tocou."
                />
              </label>
            ) : null}
            <label class="stack" style={{ '--gap': '6px' }}>
              <span class="h3">
                O que podemos melhorar? <span class="xs">(opcional)</span>
              </span>
              <textarea
                class="input"
                rows={2}
                maxLength={LIMITS.feedbackCommentMax}
                value={improvement}
                disabled={busy}
                onInput={(e) => setImprovement(e.currentTarget.value)}
                placeholder="Conte uma sugestão para esta tela ou para a plataforma."
              />
            </label>
            {error ? (
              <p class="sm" role="alert">
                {error} Seu feedback continua aqui. Tente enviar novamente.
              </p>
            ) : null}
            <button type="submit" class="btn" disabled={!stars || hadDifficulty == null || busy} aria-busy={busy}>
              {busy ? 'Enviando…' : 'Enviar e continuar'}
              <Icon name="next" size={18} />
            </button>
            <button type="button" class="btn link" disabled={busy} onClick={cancel}>
              Voltar à etapa
            </button>
          </form>
        </div>
      </div>
    </Overlay>
  );
}
