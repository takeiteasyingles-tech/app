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
  ebookNum: number | null;
  extraId: string | null;
  seasonN: number | null;
}) {
  return (
    <Card
      title="Materiais e avaliação do episódio"
      sub="Jornada de 10 etapas, e-book, extra e teste ficam juntos neste episódio."
    >
      <div class="row wrapx" style={{ '--gap': '10px' }}>
        {ebookNum ? (
          <>
            <LinkButton href={`conteudo/episodios/${num}/ebook`} label="E-book" icon="book" kind="light" />
            <LinkButton href={`conteudo/episodios/${num}/teste`} label="Teste e liberação" icon="list" kind="light" />
          </>
        ) : (
          <span class="xs">Selecione um e-book exclusivo nos dados do episódio.</span>
        )}
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

function MaterialEditor({ params, q, kind }: ScreenProps & { kind: 'book' | 'extra' | 'test' | 'seasonTest' }) {
  const ep = Number(params.ep);
  const load = useLoad((signal) => call(adminContentApi.episodes.get, { params: { id: String(ep) }, signal }), [ep]);
  return (
    <Async load={load}>
      {({ item }) =>
        kind === 'extra' && item.extraId ? (
          <ExtraEdit params={{ id: item.extraId, ep: String(ep) }} q={q} />
        ) : kind === 'seasonTest' && item.seasonN ? (
          <SeasonTestEditor params={{ n: String(item.seasonN), ep: String(ep) }} q={q} />
        ) : (kind === 'book' || kind === 'test') && item.ebookNum ? (
          <EbookEdit params={{ num: String(item.ebookNum), ep: String(ep) }} q={q} testOnly={kind === 'test'} />
        ) : (
          <Card title="Material não configurado">
            <p>Vincule o material nos dados do episódio.</p>
          </Card>
        )
      }
    </Async>
  );
}

export const EpisodeBook = (props: ScreenProps) => <MaterialEditor {...props} kind="book" />;
export const EpisodeExtra = (props: ScreenProps) => <MaterialEditor {...props} kind="extra" />;
export const EpisodeTest = (props: ScreenProps) => <MaterialEditor {...props} kind="test" />;
export const EpisodeSeasonTest = (props: ScreenProps) => <MaterialEditor {...props} kind="seasonTest" />;
