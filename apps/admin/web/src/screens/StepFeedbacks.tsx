import { adminFeedbackApi } from '@tie/shared/contracts/feedback';
import { call } from '../api';
import { fmtDateTime } from '../format';
import { setQuery } from '../router';
import { can } from '../session';
import { usePaged } from '../ui/async';
import { Button, Empty, ErrorBox, MoreButton, Sel, Skeleton, TextIn } from '../ui/kit';
import { Stars } from './learning';
import type { ScreenProps } from './registry';

export function StepFeedbacks({ q }: Pick<ScreenProps, 'q'>) {
  const episode = /^\d{1,6}$/.test(q.ep ?? '') && Number(q.ep) > 0 ? Number(q.ep) : undefined;
  const step = /^(?:[1-9]|10)$/.test(q.etapa ?? '') ? Number(q.etapa) : undefined;
  const page = usePaged(
    (cursor, signal) =>
      call(adminFeedbackApi.steps, {
        query: { episode, step, cursor, limit: 30 },
        signal,
      }),
    [episode, step],
  );
  return (
    <section class="stack" style={{ '--gap': '16px' }} aria-label="Feedbacks da plataforma por etapa">
      <p class="sm">Experiência dos alunos com as telas e os recursos da plataforma, registrada ao avançar de etapa.</p>
      <div class="ad-filters">
        <label class="ad-dl" for="step-fb-ep">
          <span>Episódio</span>
          <TextIn
            id="step-fb-ep"
            type="number"
            min={1}
            value={episode == null ? '' : String(episode)}
            onValue={(v) => setQuery({ ep: v })}
            placeholder="Todos"
          />
        </label>
        <Sel
          ariaLabel="Etapa"
          value={step == null ? '' : String(step)}
          onValue={(v) => setQuery({ etapa: v })}
          options={[
            ['', 'Todas as etapas'],
            ...Array.from({ length: 10 }, (_, i) => [String(i + 1), `Etapa ${i + 1}`] as const),
          ]}
        />
        {episode != null || step != null ? (
          <Button label="Limpar" kind="link" onClick={() => setQuery({ ep: '', etapa: '' })} />
        ) : null}
        <Button label="Atualizar" kind="light" icon="refresh" onClick={page.reload} />
      </div>
      {page.error && !page.items.length ? (
        <ErrorBox error={page.error} retry={page.reload} />
      ) : page.loading ? (
        <Skeleton rows={4} height={140} />
      ) : !page.items.length ? (
        <Empty
          icon="chat"
          title="Nenhum feedback da plataforma ainda."
          body="As respostas aparecem aqui quando a flag feedback.steps está ligada e os alunos avançam nas etapas."
        />
      ) : (
        <>
          <ul class="ad-fb-list">
            {page.items.map((r) => (
              <li key={r.id} class="ad-fb-item">
                <div class="ad-fb-item-h">
                  <Stars value={r.stars} size={17} label={`${r.stars} de 5 estrelas`} />
                  <span class="ad-fb-item-ep">
                    <b>{`Ep. ${r.episodeNum} · etapa ${r.step}`}</b>
                    {r.episodeTitle ? ` · ${r.episodeTitle}` : ''}
                  </span>
                </div>
                <p class="sm mt8">
                  <b>Sentiu dificuldade:</b> {r.hadDifficulty ? 'Sim' : 'Não'}
                </p>
                {r.difficulty ? (
                  <p class="ad-fb-item-c">
                    <b>Dificuldade:</b> {r.difficulty}
                  </p>
                ) : null}
                {r.improvement ? (
                  <p class="ad-fb-item-c">
                    <b>Sugestão de melhoria:</b> {r.improvement}
                  </p>
                ) : null}
                <div class="xs ad-fb-item-f">
                  {can('users.read') ? (
                    <a class="ad-linkbtn" href={`#/alunos/${r.userId}`}>
                      {r.userName || 'Aluno sem nome'}
                    </a>
                  ) : (
                    <span>{r.userName || 'Aluno sem nome'}</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{fmtDateTime(r.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
          {page.hasMore ? <MoreButton loading={page.loadingMore} onClick={page.more} /> : null}
        </>
      )}
    </section>
  );
}
