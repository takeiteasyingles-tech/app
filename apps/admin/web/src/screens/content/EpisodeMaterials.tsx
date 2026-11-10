import { adminContentApi } from '@tie/shared/contracts/admin';
import { call } from '../../api';
import { useLoad } from '../../ui/async';
import { Async, Card, LinkButton } from '../../ui/kit';
import type { ScreenProps } from '../registry';
import { ExtraEdit } from './Extras';
import { SeasonTestEditor } from './SeasonTest';

export function EpisodeMaterials({
  num,
  extraId,
  seasonN,
}: {
  num: number;
  extraId: string | null;
  seasonN: number | null;
}) {
  return (
    <Card
      title="Materiais e avaliação do episódio"
      sub="Jornada de 9 etapas, extra e avaliação da temporada ficam juntos neste episódio."
    >
      <div class="row wrapx" style={{ '--gap': '10px' }}>
        {extraId ? (
          <LinkButton href={`conteudo/episodios/${num}/extra`} label="Extra" icon="tv" kind="light" />
        ) : (
          <span class="xs">Selecione um extra nos dados do episódio.</span>
        )}
        {seasonN ? (
          <LinkButton
            href={`conteudo/episodios/${num}/teste-temporada`}
            label="Avaliação da temporada"
            icon="trophy"
            kind="light"
          />
        ) : null}
      </div>
    </Card>
  );
}

function MaterialEditor({ params, q, kind }: ScreenProps & { kind: 'extra' | 'seasonTest' }) {
  const ep = Number(params.ep);
  const load = useLoad((signal) => call(adminContentApi.episodes.get, { params: { id: String(ep) }, signal }), [ep]);
  return (
    <Async load={load}>
      {({ item }) =>
        kind === 'extra' && item.extraId ? (
          <ExtraEdit params={{ id: item.extraId, ep: String(ep) }} q={q} />
        ) : kind === 'seasonTest' && item.seasonN ? (
          <SeasonTestEditor params={{ n: String(item.seasonN), ep: String(ep) }} q={q} />
        ) : (
          <Card title="Material não configurado">
            <p>Vincule o material nos dados do episódio.</p>
          </Card>
        )
      }
    </Async>
  );
}

export const EpisodeExtra = (props: ScreenProps) => <MaterialEditor {...props} kind="extra" />;
export const EpisodeSeasonTest = (props: ScreenProps) => <MaterialEditor {...props} kind="seasonTest" />;
