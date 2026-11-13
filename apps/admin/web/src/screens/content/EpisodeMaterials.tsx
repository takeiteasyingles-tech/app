import { adminContentApi } from '@tie/shared/contracts/admin';
import { call } from '../../api';
import { useLoad } from '../../ui/async';
import { Async, Card, LinkButton } from '../../ui/kit';
import type { ScreenProps } from '../registry';
import { EbookEdit } from './Ebooks';
import { ExtraEdit } from './Extras';
import { SeasonTestEditor } from './SeasonTest';

export function EpisodeMaterials({
  num,
  ebookNum,
  extraId,
  seasonN,
}: {
  num: number;
  /** The episode test lives on its (hidden) e-book row: Take the Test edits its questions. */
  ebookNum: number | null;
  extraId: string | null;
  seasonN: number | null;
}) {
  return (
    <Card
      title="Materiais e avaliação do episódio"
      sub="Jornada de 10 etapas, teste do episódio (Take the Test), extra e avaliação da temporada ficam juntos neste episódio."
    >
      <div class="row wrapx" style={{ '--gap': '10px' }}>
        {ebookNum ? (
          <LinkButton href={`conteudo/episodios/${num}/teste`} label="Take the Test" icon="list" kind="light" />
        ) : null}
        {ebookNum ? (
          // PROD (spec 05 "Take Some Extras at the end of every episode").
          <LinkButton href={`conteudo/episodios/${num}/extras`} label="Take Some Extras" icon="layers" kind="light" />
        ) : null}
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

function MaterialEditor({ params, q, kind }: ScreenProps & { kind: 'extra' | 'extras' | 'test' | 'seasonTest' }) {
  const ep = Number(params.ep);
  const load = useLoad((signal) => call(adminContentApi.episodes.get, { params: { id: String(ep) }, signal }), [ep]);
  return (
    <Async load={load}>
      {({ item }) =>
        kind === 'extra' && item.extraId ? (
          <ExtraEdit params={{ id: item.extraId, ep: String(ep) }} q={q} />
        ) : kind === 'extras' && item.ebookNum ? (
          <EbookEdit params={{ num: String(item.ebookNum), ep: String(ep) }} q={q} extrasOnly />
        ) : kind === 'test' && item.ebookNum ? (
          <EbookEdit params={{ num: String(item.ebookNum), ep: String(ep) }} q={q} testOnly />
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
export const EpisodeTest = (props: ScreenProps) => <MaterialEditor {...props} kind="test" />;
export const EpisodeBookExtras = (props: ScreenProps) => <MaterialEditor {...props} kind="extras" />;
export const EpisodeSeasonTest = (props: ScreenProps) => <MaterialEditor {...props} kind="seasonTest" />;
