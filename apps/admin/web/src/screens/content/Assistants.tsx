// Assistentes do Mic: public profile (name, tag, greeting), voice (server TTS speaker and browser
// voice), poster, thumbnail, the four video clips and the Mic avatar (PROD, spec 05 "Mic avatar per
// assistant": the Assistia embed or an ElevenLabs agent). The persona (the AI's instructions) is a
// separate, admin-only field (ai.persona): editors never see it.
import { AGENT_MODES, type AgentMode, type MicAvatar } from '@tie/shared/content/schema';
import {
  type AssistantRow,
  AssistantEdit as AssistantSchema,
  adminAiApi,
  adminContentApi,
} from '@tie/shared/contracts/admin';
import { adminVoicesApi, type ElevenAgentInfo } from '@tie/shared/contracts/voices';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { go } from '../../router';
import { can } from '../../session';
import { useLoad } from '../../ui/async';
import type { CustomProps, Obj, Spec } from '../../ui/form';
import { Icon } from '../../ui/icons';
import {
  Area,
  Async,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Page,
  Pill,
  Sel,
  Skeleton,
  Switch,
  TextIn,
} from '../../ui/kit';
import { useMedia } from '../../ui/media';
import { toast } from '../../ui/toast';
import { zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { CreateModal, type CrudApi, crud, DraftNote, keysOf, patchOf, pick, slugify } from './common';
import { DocEditor, tabFinder } from './DocEditor';

const C = adminContentApi;
const KEYS = keysOf(AssistantSchema.create);

/** Deepgram Aura voices the Worker accepts (apps/admin/worker lib/entities AURA_SPEAKERS). */
const SPEAKERS: readonly (readonly [string, 'f' | 'm'])[] = [
  ['asteria', 'f'],
  ['luna', 'f'],
  ['stella', 'f'],
  ['athena', 'f'],
  ['hera', 'f'],
  ['orion', 'm'],
  ['arcas', 'm'],
  ['perseus', 'm'],
  ['angus', 'm'],
  ['orpheus', 'm'],
  ['helios', 'm'],
  ['zeus', 'm'],
];

/** "asteria" → "Asteria (feminina)". */
export function voiceLabel(key: string): string {
  const g = SPEAKERS.find(([k]) => k === key)?.[1];
  const name = key.charAt(0).toUpperCase() + key.slice(1);
  return g ? `${name} (${g === 'f' ? 'feminina' : 'masculina'})` : name;
}

/** Assistia's embed origin (the student app's AvatarEmbed.tsx and both CSPs' frame-src). */
const ASSISTIA_ORIGIN = 'https://assistia-backend.perfectdesigner.workers.dev';

const AVATAR_KINDS = [
  ['none', 'Vídeos e 3D da própria assistente'],
  ['assistia', 'Assistente virtual (embed)'],
  ['elevenlabs', 'Agente ElevenLabs'],
] as const;

const MODE_LABEL: Record<AgentMode, string> = { livre: 'Conversa livre', missao: 'Missões', extra: 'Extras' };

type AvatarDraft = { kind?: string; slug?: string; agentId?: string; modes?: string[] } | null;

const AVATAR_ERRORS: Record<string, string> = {
  agentId: 'Cole o ID do agente da ElevenLabs (começa com “agent_”).',
  slug: 'Use o identificador do avatar: letras, números, - e _ (ex.: marguert).',
  modes: 'Escolha pelo menos um modo para o agente.',
};

/** "Agente ElevenLabs" / "Assistente virtual" (list card and preview). */
export function avatarLabel(a: MicAvatar | null | undefined): string {
  return a?.kind === 'elevenlabs' ? 'Agente ElevenLabs' : a?.kind === 'assistia' ? 'Assistente virtual' : 'Vídeos e 3D';
}

/** The agent as the stored ElevenLabs key sees it, with what would keep tie-app from using it. */
function AgentCheck({ agentId }: { agentId: string }) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<ElevenAgentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    setError(null);
  }, [agentId]);
  const valid = /^agent_[a-z0-9]{8,60}$/i.test(agentId);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setInfo((await call(adminVoicesApi.agent, { query: { id: agentId } })).agent);
    } catch (e) {
      setInfo(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const missing = info ? ['student_name', 'student_level'].filter((v) => !info.variables.includes(v)) : [];
  return (
    <div class="ad-span stack" style={{ '--gap': '8px' }}>
      <div class="row" style={{ '--gap': '8px' }}>
        <Button
          label="Verificar agente"
          icon="check"
          kind="light"
          busy={busy}
          disabled={!valid}
          onClick={() => void check()}
        />
        <span class="xs grow">Usa a chave da ElevenLabs salva em Configurações → Vozes.</span>
      </div>
      {error ? <div class="ad-note">{error}</div> : null}
      {info ? (
        <div class="ad-note bl stack" style={{ '--gap': '4px' }}>
          <b>{info.name}</b>
          <span class="xs">
            Idioma {info.language ?? '—'} · modelo {info.llm ?? '—'} · voz {info.voiceId ?? '—'}
            {info.maxDurationS ? ` · até ${Math.round(info.maxDurationS / 60)} min por conversa` : ''}
          </span>
          {info.firstMessage ? <span class="xs">Primeira fala: “{info.firstMessage}”</span> : null}
          {info.authEnabled ? (
            <span class="xs">Autenticação ligada: só o app, com URLs assinadas, inicia conversas.</span>
          ) : (
            <span class="xs ad-err-t">
              A autenticação do agente está desligada: quem souber o ID pode conversar com ele e gastar os créditos da
              conta. Ligue “Enable authentication” em ElevenLabs → Agente → Security (o app continua funcionando, ele já
              usa URLs assinadas).
            </span>
          )}
          {missing.length ? (
            <span class="xs">
              O prompt não usa {missing.join(' e ')}: o app envia o nome e o nível do aluno nessas variáveis.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Avatar no Mic: the assistant's own 3D/videos, the Assistia embed or an ElevenLabs agent. */
function AvatarField({ value, set, id, err }: CustomProps) {
  const v = (value && typeof value === 'object' ? value : null) as AvatarDraft;
  const kind = v?.kind ?? 'none';
  const pick = (k: string) =>
    set(
      k === 'assistia'
        ? { kind: 'assistia', slug: v?.slug ?? '' }
        : k === 'elevenlabs'
          ? { kind: 'elevenlabs', agentId: v?.agentId ?? '', modes: v?.modes?.length ? v.modes : ['livre'] }
          : null,
    );
  const modes = v?.modes ?? [];
  const toggle = (m: AgentMode, on: boolean) =>
    set({ ...v, modes: AGENT_MODES.filter((x) => (x === m ? on : modes.includes(x))) });
  return (
    <div class="ad-span stack" style={{ '--gap': '12px' }}>
      <Field
        id={id}
        label="Avatar no Mic"
        hint="O que o aluno vê e ouve na conversa do Mic. Os vídeos abaixo seguem valendo quando o embed não carrega e como rosto do agente."
        err={kind === 'none' ? err : null}
      >
        <Sel id={id} value={kind} options={AVATAR_KINDS} onValue={pick} />
      </Field>
      {kind === 'assistia' ? (
        <Field
          id={`${id}-slug`}
          label="Identificador do avatar"
          hint="O fim do endereço do embed: …/embed/marguert. A IA do curso escreve as falas; o embed dá o rosto e a voz."
          err={err}
        >
          <TextIn
            id={`${id}-slug`}
            class="ad-mono"
            value={v?.slug ?? ''}
            err={err}
            maxLength={60}
            onValue={(slug) => set({ kind: 'assistia', slug: slug.trim() })}
          />
        </Field>
      ) : null}
      {kind === 'elevenlabs' ? (
        <>
          <Field
            id={`${id}-agent`}
            label="ID do agente"
            hint="Em ElevenLabs → Agents, começa com “agent_”. O agente conversa com a própria voz e o próprio prompt; o ID nunca vai para o app do aluno."
            err={err}
          >
            <TextIn
              id={`${id}-agent`}
              class="ad-mono"
              value={v?.agentId ?? ''}
              err={err}
              maxLength={70}
              placeholder="agent_…"
              onValue={(agentId) => set({ ...v, kind: 'elevenlabs', agentId: agentId.trim() })}
            />
          </Field>
          <fieldset class="ad-span ad-obj">
            <legend class="ad-flabel">Modos em que o agente conversa</legend>
            <div class="row wrapx" style={{ '--gap': '16px' }}>
              {AGENT_MODES.map((m) => (
                <span key={m} class="row" style={{ '--gap': '8px' }}>
                  <Switch
                    id={`${id}-mode-${m}`}
                    on={modes.includes(m)}
                    label={MODE_LABEL[m]}
                    onChange={(on) => toggle(m, on)}
                  />
                  <label for={`${id}-mode-${m}`} class="sm">
                    {MODE_LABEL[m]}
                  </label>
                </span>
              ))}
            </div>
            <small class="xs">
              Nos outros modos (e na Pronúncia) a conversa segue com a IA do curso. Cada conversa reserva até 10 minutos
              do plano do aluno e cobra o tempo que a ElevenLabs mediu.
            </small>
          </fieldset>
          <AgentCheck agentId={v?.agentId ?? ''} />
        </>
      ) : null}
    </div>
  );
}

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
      options: SPEAKERS.map(([s]) => [s, voiceLabel(s)] as const),
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
    { t: 'custom', k: 'avatar', label: 'Avatar no Mic', wide: true, render: (p) => <AvatarField {...p} /> },
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
            <Button
              label="Salvar persona"
              icon="check"
              busy={busy}
              disabled={!dirty || !text.trim()}
              onClick={() => void save()}
            />
            <Button
              label="Descartar"
              kind="light"
              disabled={!dirty || busy}
              onClick={() => setText(load.data?.persona ?? '')}
            />
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
              {thumb ? (
                <img src={thumb.url} alt="" />
              ) : (
                <span class="av-ini" style={{ '--s': '60px' }}>
                  {d.name.slice(0, 2).toUpperCase()}
                </span>
              )}
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
      <AvatarPreview a={d.avatar} name={d.fullName} />
    </aside>
  );
}

/** Avatar no Mic, as the student will get it: the live embed, or what the agent takes over. */
function AvatarPreview({ a, name }: { a: MicAvatar | null | undefined; name: string }) {
  const slug = a?.kind === 'assistia' && /^[a-z0-9][a-z0-9_-]{0,59}$/i.test(a.slug) ? a.slug : null;
  return (
    <div class="stack mt12" style={{ '--gap': '6px' }}>
      <span class="lbl">Avatar no Mic · {avatarLabel(a)}</span>
      {slug ? (
        <iframe
          class="ad-avemb"
          src={`${ASSISTIA_ORIGIN}/embed/${encodeURIComponent(slug)}`}
          title={name}
          allow="autoplay"
          sandbox="allow-scripts allow-same-origin"
          referrerpolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      ) : a?.kind === 'elevenlabs' ? (
        <p class="xs">
          Em {a.modes.map((m) => MODE_LABEL[m]).join(', ')}, o aluno conversa por voz, ao vivo, com o agente da
          ElevenLabs: o microfone fica aberto e o avatar 3D (ou os vídeos) acompanha a voz do agente.
        </p>
      ) : (
        <p class="xs">O Mic mostra o avatar 3D da assistente, se houver, senão os vídeos desta aba.</p>
      )}
    </div>
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
      validate={(d) => {
        // The avatar is one custom field: its inner errors (avatar.agentId…) become one, under it.
        const e = zodErrors(AssistantSchema.create, d);
        const inner = Object.keys(e).filter((k) => k.startsWith('avatar.'));
        for (const k of inner) delete e[k];
        if (inner.length) e.avatar = AVATAR_ERRORS[inner[0]?.split('.')[1] ?? ''] ?? 'Confira o avatar.';
        return e;
      }}
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

function Poster({ id, name }: { id: string | null; name: string }) {
  const m = useMedia(id);
  return (
    <span class="ad-acard-art">
      {m ? (
        <img class="ad-acard-img" src={m.url} alt="" loading="lazy" decoding="async" />
      ) : m === undefined ? null : (
        <span class="ad-acard-ini" aria-hidden="true">
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function AssistantCard({ a }: { a: AssistantRow }) {
  const clips = Object.keys(a.clips).length;
  return (
    <a class="ad-acard" href={`#/conteudo/assistentes/${a.key}`}>
      <Poster id={a.posterMedia ?? a.thumbMedia} name={a.name} />
      <span class="ad-acard-st">
        <Pill label={a.active ? 'Disponível' : 'Fora da escolha'} tone={a.active ? 'gr' : ''} />
      </span>
      <span class="ad-acard-b">
        <span class="ad-cell2">
          <b class="h3">{a.name}</b>
          <span class="xs">{a.fullName}</span>
        </span>
        <span class="sm ad-acard-tag">{a.tag || a.role || 'Sem descrição curta'}</span>
        <dl class="ad-acard-facts">
          <div>
            <dt>Voz</dt>
            <dd>{voiceLabel(a.ttsSpeaker)}</dd>
          </div>
          {a.avatar ? (
            <div>
              <dt>Avatar</dt>
              <dd>{avatarLabel(a.avatar)}</dd>
            </div>
          ) : (
            <div>
              <dt>Vídeos</dt>
              <dd class={clips < 4 ? 'ad-err-t' : ''}>{clips} de 4</dd>
            </div>
          )}
        </dl>
      </span>
    </a>
  );
}

export function Assistants(_: ScreenProps) {
  const load = useLoad((signal) => call(C.assistants.list, { query: {}, signal }), []);
  const [creating, setCreating] = useState(false);
  const all = load.data?.items ?? [];
  return (
    <Page
      title="Assistentes"
      kicker="Conteúdo · Mic"
      actions={<Button label="Nova assistente" icon="plus" onClick={() => setCreating(true)} />}
    >
      <DraftNote />
      <Async load={load}>
        {(d) =>
          d.items.length ? (
            <div class="ad-agrid">
              {d.items.map((a) => (
                <AssistantCard key={a.key} a={a} />
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
