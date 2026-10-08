// Missões do Mic: scripted role-plays (the assistant's turns, the words each one teaches, where it
// ends). The AI improvises around them; the demo mode plays them as written.
import { adminContentApi, MissionEdit as MissionSchema, type MissionRow } from '@tie/shared/contracts/admin';
import { useState } from 'preact/hooks';
import { call } from '../../api';
import { go } from '../../router';
import { useLoad } from '../../ui/async';
import type { Obj, Spec } from '../../ui/form';
import { Async, Button, Empty, Page } from '../../ui/kit';
import { type Col, Table } from '../../ui/table';
import { zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { type CrudApi, CreateModal, crud, DraftNote, keysOf, patchOf, pick, slugify } from './common';
import { DocEditor } from './DocEditor';

const C = adminContentApi;
const KEYS = keysOf(MissionSchema.create);

const SPECS: Record<string, readonly Spec[]> = {
  '': [
    { t: 'text', k: 'key', label: 'Identificador', ro: true, mono: true },
    { t: 'text', k: 'title', label: 'Título', hint: 'Ex.: "Pedir um café".' },
    { t: 'text', k: 'role', label: 'Papel da assistente', opt: 'null', hint: 'Ex.: "barista".' },
    { t: 'int', k: 'sort', label: 'Ordem' },
    { t: 'text', k: 'goal', label: 'Objetivo do aluno', opt: 'null', rows: 2 },
    {
      t: 'list',
      k: 'turns',
      label: 'Falas da assistente',
      item: 'fala',
      summary: (v) => `${String(v.en ?? '')}${v.end ? ' · fim' : ''}`,
      make: () => ({ en: '', pt: '', words: [] }),
      hint: '{N} = nome do aluno, {A} = nome da assistente.',
      of: [
        { t: 'text', k: 'en', label: 'Inglês', rows: 2 },
        { t: 'text', k: 'pt', label: 'Tradução', rows: 2 },
        { t: 'bool', k: 'end', label: 'Encerra a missão', opt: 'undef' },
        {
          t: 'list',
          k: 'words',
          label: 'Palavras ensinadas',
          item: 'palavra',
          inline: true,
          of: [
            { t: 'text', k: 'en', label: 'Inglês' },
            { t: 'text', k: 'pt', label: 'Tradução' },
          ],
        },
      ],
    },
  ],
};
const ALL = SPECS[''] ?? [];

function Preview({ d }: { d: MissionRow }) {
  return (
    <aside class="ad-preview" aria-label="Prévia da conversa">
      <span class="lbl">Prévia da conversa</span>
      <div class="ad-phone">
        <div class="ad-phone-in navy on-navy">
          <div class="stack" style={{ '--gap': '4px' }}>
            <span class="lbl or">Missão</span>
            <div class="h3">{d.title}</div>
            {d.goal ? <p class="sm">{d.goal}</p> : null}
          </div>
          <div class="transcript" style={{ padding: '0' }}>
            {d.turns.map((t, i) => (
              <div key={i} class="bub her" style={{ animation: 'none' }}>
                <div class="en">{t.en.replace(/\{N\}/g, 'Ana').replace(/\{A\}/g, 'Maggie')}</div>
                <div class="pt">{t.pt.replace(/\{N\}/g, 'Ana').replace(/\{A\}/g, 'Maggie')}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

export function MissionEdit({ params }: ScreenProps) {
  const key = params.key ?? '';
  return (
    <DocEditor<Obj>
      load={async (signal) => pick((await crud.get<Obj>(C.missions as CrudApi, key, signal)).item, KEYS)}
      deps={[key]}
      title={(d) => String(d.title || key)}
      kicker="Missão do Mic"
      back="conteudo/missoes"
      noun="Missão"
      specs={SPECS}
      allSpecs={ALL}
      idp="mi"
      validate={(d) => zodErrors(MissionSchema.create, d)}
      persist={async (base, d) => {
        const patch = patchOf(base, d, KEYS);
        if (!Object.keys(patch).length) return d;
        return pick((await crud.update<Obj>(C.missions as CrudApi, key, patch)).item, KEYS);
      }}
      preview={(d) => <Preview d={d as unknown as MissionRow} />}
      remove={{
        id: key,
        body: 'Se alguma conversa do Mic usou esta missão, o servidor recusa.',
        run: () => crud.remove(C.missions as CrudApi, key),
        after: 'conteudo/missoes',
      }}
    />
  );
}

export function Missions(_: ScreenProps) {
  const load = useLoad((signal) => call(C.missions.list, { query: {}, signal }), []);
  const [creating, setCreating] = useState(false);
  const cols: Col<MissionRow>[] = [
    {
      key: 't',
      label: 'Missão',
      cell: (m) => (
        <span class="ad-cell2">
          <span>{m.title}</span>
          <span class="xs">{m.goal ?? ''}</span>
        </span>
      ),
    },
    { key: 'r', label: 'Papel', cell: (m) => m.role ?? '—' },
    { key: 'n', label: 'Falas', cls: 'num', cell: (m) => String(m.turns.length) },
    { key: 's', label: 'Ordem', cls: 'num', cell: (m) => String(m.sort) },
  ];
  const all = load.data?.items ?? [];
  return (
    <Page title="Missões do Mic" kicker="Conteúdo" actions={<Button label="Nova missão" icon="plus" onClick={() => setCreating(true)} />}>
      <DraftNote />
      <Async load={load}>
        {(d) =>
          d.items.length ? (
            <Table rows={d.items} cols={cols} rowKey={(m) => m.key} href={(m) => `conteudo/missoes/${m.key}`} caption="Missões" />
          ) : (
            <Empty icon="target" title="Nenhuma missão ainda." />
          )
        }
      </Async>
      {creating ? (
        <CreateModal
          noun="Missão"
          idLabel="Identificador"
          idHint="Letras minúsculas, números e hífen."
          onClose={() => setCreating(false)}
          create={async (id, title) => {
            const key = slugify(id) || id;
            await call(C.missions.create, {
              body: {
                key,
                title,
                role: null,
                goal: null,
                turns: [{ en: 'Hi {N}! …', pt: 'Oi, {N}! …', words: [] }],
                sort: all.reduce((m, x) => Math.max(m, x.sort), 0) + 1,
              },
            });
            go(`conteudo/missoes/${key}`);
          }}
        />
      ) : null}
    </Page>
  );
}
