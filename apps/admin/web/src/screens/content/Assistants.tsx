// Assistentes do Mic: public profile (name, tag, greeting), voice (server TTS speaker and browser
// voice), poster, thumbnail and the four video clips. The persona (the AI's instructions) is a separate,
// admin-only field (ai.persona): editors never see it.
import { adminAiApi, AssistantEdit as AssistantSchema, type AssistantRow, adminContentApi } from '@tie/shared/contracts/admin';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { go } from '../../router';
import { can } from '../../session';
import { useLoad } from '../../ui/async';
import type { Obj, Spec } from '../../ui/form';
import { Icon } from '../../ui/icons';
import { Area, Async, Button, Card, Empty, ErrorBox, Field, Page, Pill, Skeleton } from '../../ui/kit';
import { useMedia } from '../../ui/media';
import { toast } from '../../ui/toast';
import { zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { type CrudApi, CreateModal, crud, DraftNote, keysOf, patchOf, pick, slugify } from './common';
import { DocEditor, tabFinder } from './DocEditor';

const C = adminContentApi;
const KEYS = keysOf(AssistantSchema.create);

/** Deepgram Aura voices the Worker accepts (apps/admin/worker lib/entities AURA_SPEAKERS). */
const SPEAKERS = ['asteria', 'luna', 'stella', 'athena', 'hera', 'orion', 'arcas', 'perseus', 'angus', 'orpheus', 'helios', 'zeus'];

const SPECS: Record<string, readonly Spec[]> = {
  perfil: [
    { t: 'text', k: 'key', label: 'Identificador', ro: true, mono: true },
    { t: 'text', k: 'name', label: 'Nome', hint: 'Ex.: "Maggie".' },
    { t: 'text', k: 'fullName', label: 'Nome completo' },
    {
      t: 'select',
      k: 'art',
      label: 'Artigo',
      hint: 'Como o app se refere a ela/ele: "a Maggie", "o Robert".',
      options: [
        ['a', 'a (feminino)'],
        ['o', 'o (masculino)'],
      ],
    },
    { t: 'int', k: 'age', label: 'Idade', opt: 'null', min: 1 },
    { t: 'strings', k: 'aka', label: 'Também chamada de', hint: 'Apelidos que o aluno pode usar.' },
    { t: 'text', k: 'role', label: 'Quem é', opt: 'null', hint: 'Ex.: "dona do café".' },
    { t: 'text', k: 'tag', label: 'Estilo em 2 palavras', opt: 'null', hint: 'Aparece em destaque na escolha.' },
    { t: 'text', k: 'style', label: 'Como conversa', opt: 'null', rows: 2 },
    { t: 'text', k: 'helloEn', label: 'Saudação (inglês)', opt: 'null', rows: 2 },
    { t: 'text', k: 'helloPt', label: 'Saudação (tradução)', opt: 'null', rows: 2 },
    { t: 'int', k: 'sort', label: 'Ordem' },
    { t: 'bool', k: 'active', label: 'Disponível para os alunos' },
  ],
  voz: [
    {
      t: 'select',
      k: 'ttsSpeaker',
      label: 'Voz do servidor (TTS)',
      hint: 'Voz Deepgram Aura usada com a IA ligada.',
      options: SPEAKERS.map((s) => [s, s] as const),
    },
    {
      t: 'obj',
      k: 'voice',
      label: 'Voz do navegador (modo demo)',
      of: [
        {
          t: 'select',
          k: 'gender',
          label: 'Gênero da voz',
          options: [
            ['female', 'Feminina'],
            ['male', 'Masculina'],
          ],
        },
        { t: 'num', k: 'pitch', label: 'Tom', step: 0.05, min: 0, max: 2 },
        { t: 'num', k: 'rate', label: 'Velocidade', step: 0.05, min: 0.1, max: 2 },
        { t: 'text', k: 'prefer', label: 'Voz preferida', opt: 'undef', hint: 'Nome da voz do sistema, ex.: "Ana".' },
        { t: 'num', k: 'preferPitch', label: 'Tom com a voz preferida', opt: 'undef', step: 0.05 },
        { t: 'num', k: 'preferRate', label: 'Velocidade com a voz preferida', opt: 'undef', step: 0.05 },
      ],
    },
  ],
  midia: [
    { t: 'media', k: 'posterMedia', label: 'Pôster', kind: 'image', opt: 'null' },
    { t: 'media', k: 'thumbMedia', label: 'Miniatura (rosto)', kind: 'image', opt: 'null' },
    {
      t: 'obj',
      k: 'clips',
      label: 'Vídeos do avatar',
      of: [
        { t: 'media', k: 'idle', label: 'Parada (idle)', kind: 'video', opt: 'undef' },
        { t: 'media', k: 'talk', label: 'Falando', kind: 'video', opt: 'undef' },
        { t: 'media', k: 'talk-happy', label: 'Falando, animada', kind: 'video', opt: 'undef' },
        { t: 'media', k: 'talk-soft', label: 'Falando, com calma', kind: 'video', opt: 'undef' },
      ],
    },
  ],
};

const TABS = [
  ['perfil', 'Perfil'],
  ['voz', 'Voz'],
  ['midia', 'Imagens e vídeos'],
] as const;
const ALL = Object.values(SPECS).flat();
const tabOf = tabFinder(SPECS, 'perfil');

function Persona({ k }: { k: string }) {
  const load = useLoad((signal) => call(adminAiApi.persona, { params: { key: k }, signal }), [k]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (load.data) setText(load.data.persona);
  }, [load.data]);
  const dirty = !!load.data && text !== load.data.persona;
  const save = async () => {
    setBusy(true);
    try {
      const res = await call(adminAiApi.setPersona, { params: { key: k }, body: { persona: text.trim() } });
      load.setData(res);
      setText(res.persona);
      toast('Persona salva. Vale para as próximas conversas.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Persona da IA"
      sub="Instruções que a IA segue como esta assistente. Nunca aparece para os alunos."
      actions={<Pill label="Só admins" tone="navy" icon="lock" />}
    >
      {load.error && !load.data ? (
        <ErrorBox error={load.error} retry={load.reload} />
      ) : !load.data ? (
        <Skeleton rows={3} />
      ) : (
        <>
          <Field id="persona" label="Persona" hint={`${text.length} de 4000 caracteres. Vale direto, sem publicação.`}>
            <Area id="persona" value={text} onValue={setText} rows={10} maxLength={4000} />
          </Field>
          <div class="row" style={{ '--gap': '8px' }}>
            <Button label="Salvar persona" icon="check" busy={busy} disabled={!dirty || !text.trim()} onClick={() => void save()} />
            <Button label="Descartar" kind="light" disabled={!dirty || busy} onClick={() => setText(load.data?.persona ?? '')} />
          </div>
        </>
      )}
    </Card>
  );
}

function Preview({ d }: { d: AssistantRow }) {
  const thumb = useMedia(d.thumbMedia);
  return (
    <aside class="ad-preview" aria-label="Prévia para o aluno">
      <span class="lbl">Prévia na escolha do Mic</span>
      <div class="ad-phone">
        <div class="ad-phone-in navy on-navy">
          <div class="assist-row">
            <div class="assist on">
              {thumb ? <img src={thumb.url} alt="" /> : <span class="av-ini" style={{ '--s': '60px' }}>{d.name.slice(0, 2).toUpperCase()}</span>}
              <b>{d.name}</b>
              <span>{d.tag ?? ''}</span>
            </div>
          </div>
          <p class="xs">
            <b>{d.fullName}</b> {d.tag ? <span class="pill gold">{d.tag}</span> : null} {d.role ?? ''}. {d.style ?? ''}
          </p>
          {d.helloEn ? (
            <div class="bub her" style={{ animation: 'none' }}>
              <div class="en">{d.helloEn.replace(/\{N\}/g, 'Ana')}</div>
              {d.helloPt ? <div class="pt">{d.helloPt.replace(/\{N\}/g, 'Ana')}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export function AssistantEdit({ params, q }: ScreenProps) {
  const key = params.key ?? '';
  return (
    <DocEditor<Obj>
      load={async (signal) => pick((await crud.get<Obj>(C.assistants as CrudApi, key, signal)).item, KEYS)}
      deps={[key]}
      title={(d) => String(d.fullName || d.name || key)}
      kicker="Assistente"
      back="conteudo/assistentes"
      noun="Assistente"
      tabs={TABS}
      tab={q.aba}
      specs={SPECS}
      allSpecs={ALL}
      tabOf={tabOf}
      idp="as"
      header={(d) => <Pill label={d.active ? 'Disponível' : 'Fora da escolha'} tone={d.active ? 'gr' : ''} />}
      validate={(d) => zodErrors(AssistantSchema.create, d)}
      persist={async (base, d) => {
        const patch = patchOf(base, d, KEYS);
        if (!Object.keys(patch).length) return d;
        return pick((await crud.update<Obj>(C.assistants as CrudApi, key, patch)).item, KEYS);
      }}
      preview={(d) => <Preview d={d as unknown as AssistantRow} />}
      after={() =>
        can('ai.persona') ? (
          <Persona k={key} />
        ) : (
          <div class="ad-note bl">
            <Icon name="lock" size={18} /> A persona (as instruções da IA) só aparece para admins.
          </div>
        )
      }
      remove={{
        id: key,
        body: 'Se algum aluno escolheu esta assistente ou conversou com ela, o servidor recusa: desligue "Disponível" em vez de excluir.',
        run: () => crud.remove(C.assistants as CrudApi, key),
        after: 'conteudo/assistentes',
      }}
    />
  );
}

function Face({ id, name }: { id: string | null; name: string }) {
  const m = useMedia(id);
  return m ? (
    <img class="ad-thumb sq" style={{ borderRadius: '50%' }} src={m.url} alt="" loading="lazy" />
  ) : (
    <span class="av-ini" style={{ '--s': '40px' }} aria-hidden="true">
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function Assistants(_: ScreenProps) {
  const load = useLoad((signal) => call(C.assistants.list, { query: {}, signal }), []);
  const [creating, setCreating] = useState(false);
  const all = load.data?.items ?? [];
  return (
    <Page title="Assistentes" kicker="Conteúdo · Mic" actions={<Button label="Nova assistente" icon="plus" onClick={() => setCreating(true)} />}>
      <DraftNote />
      <Async load={load}>
        {(d) =>
          d.items.length ? (
            <div class="ad-mgrid">
              {d.items.map((a) => (
                <a key={a.key} class="ad-mcard" href={`#/conteudo/assistentes/${a.key}`} style={{ padding: '14px' }}>
                  <div class="row" style={{ '--gap': '10px' }}>
                    <Face id={a.thumbMedia} name={a.name} />
                    <span class="ad-cell2">
                      <b>{a.name}</b>
                      <span class="xs">{a.fullName}</span>
                    </span>
                  </div>
                  <div class="row wrapx" style={{ '--gap': '6px' }}>
                    {a.tag ? <Pill label={a.tag} tone="gold" /> : null}
                    <Pill label={a.active ? 'Disponível' : 'Fora da escolha'} tone={a.active ? 'gr' : ''} />
                    <Pill label={`voz ${a.ttsSpeaker}`} />
                  </div>
                  <span class="xs">{Object.keys(a.clips).length} de 4 vídeos</span>
                </a>
              ))}
            </div>
          ) : (
            <Empty icon="mic" title="Nenhuma assistente ainda." />
          )
        }
      </Async>
      {creating ? (
        <CreateModal
          noun="Assistente"
          idLabel="Identificador"
          idHint="Minúsculas, ex.: margaret."
          onClose={() => setCreating(false)}
          create={async (id, title) => {
            const key = slugify(id) || id;
            await call(C.assistants.create, {
              body: {
                key,
                name: title,
                fullName: title,
                art: 'a',
                age: null,
                aka: [],
                role: null,
                tag: null,
                style: null,
                helloEn: null,
                helloPt: null,
                voice: { gender: 'female', pitch: 1, rate: 1 },
                ttsSpeaker: 'asteria',
                posterMedia: null,
                thumbMedia: null,
                clips: {},
                sort: all.reduce((m, a) => Math.max(m, a.sort), 0) + 1,
                active: false,
              },
            });
            go(`conteudo/assistentes/${key}`);
          }}
        />
      ) : null}
    </Page>
  );
}
