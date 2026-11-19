// Configurações (admin): feature flags (on/off, gradual rollout, allowlists), the app settings the
// Worker reads (retention, terms version, the student app origin, the guard model), the AI providers
// (Anthropic / OpenAI keys and the model of each AI task, PROD spec 05 "Paid AI providers"), the
// voices (ElevenLabs key, model and the course voices, PROD spec 05 "Lesson voices"), the AI prompt
// templates (versioned: a save over a newer edit is refused) and Integrações (API tokens for AI agents
// over MCP, screens/ApiTokens).
import {
  type AiProvider,
  aiProviderOf,
  DEFAULT_MODELS,
  ELEVEN_DEFAULT_KEY,
  ELEVEN_EXTRAS_KEY,
  ELEVEN_MODELS,
  ELEVEN_NARRATOR_KEY,
  type ElevenModel,
  FLAGS,
  SETTINGS,
  TTS_ELEVEN,
} from '@tie/shared/constants';
import {
  type AppSetting,
  adminAiApi,
  adminOpsApi,
  type FeatureFlag,
  type PromptRow,
} from '@tie/shared/contracts/admin';
import {
  type AiProviderKey,
  type AiProviderName,
  type AiSpeedRes,
  adminAiProvidersApi,
} from '@tie/shared/contracts/aiProviders';
import { adminVoicesApi, type VoiceSettings, type VoiceSettingsBody } from '@tie/shared/contracts/voices';
import { ApiError, isErrorEnvelope } from '@tie/shared/errors';
import { useEffect, useRef, useState } from 'preact/hooks';
import { call, errorMessage, isCode, NetworkError, urlFor } from '../api';
import { fmtAgo, fmtDateTime } from '../format';
import { useEmails } from '../people';
import { setQuery } from '../router';
import { can } from '../session';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Area, Async, Button, Card, Empty, Field, Page, Pill, Sel, Switch, TabsNav, TextIn } from '../ui/kit';
import { confirmAction, Modal } from '../ui/modal';
import { toast } from '../ui/toast';
import { VoicePicker } from '../ui/voices';
import { ApiTokens } from './ApiTokens';
import type { ScreenProps } from './registry';

const FLAG_INFO: Record<string, string> = {
  [FLAGS.aiEnabled]:
    'IA ligada: conversa, pronúncia e voz pelos modelos de Provedores de IA (Workers AI, Claude ou OpenAI). Desligada, o app usa o modo demo.',
  [FLAGS.freeSteps]:
    'Modo Dev: libera o botão de avançar sem concluir vídeos, áudios, gravações ou exercícios. Vale para os alunos definidos nas regras, sem ativação adicional no perfil.',
  [FLAGS.stepFeedback]:
    'Feedback da plataforma: exige uma avaliação da experiência antes de avançar em cada etapa do episódio, inclusive ao concluir. Pergunta sobre dificuldades e sugestões de melhoria da tela.',
  [FLAGS.storeRecordings]: 'Guardar as gravações do Mic (para moderação).',
};

const SETTING_INFO: readonly (readonly [string, string, string])[] = [
  [SETTINGS.retentionTranscriptsDays, 'Dias que as conversas do Mic ficam guardadas', 'Entre 1 e 3650. Padrão: 180.'],
  [SETTINGS.termsVersion, 'Versão dos termos de uso', 'Ex.: 2026-10. Quem aceitou outra versão aceita de novo.'],
  ['app.origin', 'Endereço do app dos alunos', 'Usado nos links de nova senha (https://…, sem barra no fim).'],
  [SETTINGS.modelGuard, 'Modelo de segurança', 'Llama Guard.'],
];

const PROMPT_INFO: Record<string, string> = {
  tutor_system: 'Instruções da conversa (todas as assistentes)',
  report_system: 'Instruções do relatório no fim da conversa',
};

// ---------- AI providers (PROD spec 05 "Paid AI providers") ----------

const PROVIDER_NAME: Record<AiProviderName, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI' };

const PROVIDER_HINT: Record<AiProviderName, string> = {
  anthropic: 'console.anthropic.com → API Keys. A chave fica cifrada e nunca é mostrada de novo.',
  openai: 'platform.openai.com → API keys. A chave fica cifrada e nunca é mostrada de novo.',
};

type ModelTag = 'quality' | 'value';
interface ModelOption {
  id: string;
  label: string;
  tag?: ModelTag;
}

const TAG_PREFIX: Record<ModelTag, string> = {
  quality: '⭐ Melhor qualidade · ',
  value: '💰 Melhor custo-benefício · ',
};
const TAG_ORDER: Record<ModelTag | 'none', number> = { quality: 0, value: 1, none: 2 };

const anthropic = (m: string) => `anthropic:${m}`;
const openai = (m: string) => `openai:${m}`;

/** The conversation models (main and fallback). */
const CHAT_MODELS: readonly ModelOption[] = [
  {
    id: anthropic('claude-opus-5-5'),
    label: 'Claude Opus 5.5 · Anthropic (o mais capaz; pensa antes, responde mais devagar)',
  },
  { id: anthropic('claude-sonnet-5-5'), label: 'Claude Sonnet 5.5 · Anthropic (resposta rápida, ótimo em conversa)' },
  { id: anthropic('claude-haiku-5-5'), label: 'Claude Haiku 5.5 · Anthropic (o mais rápido e barato)' },
  { id: openai('gpt-6-astra'), label: 'GPT-6 Astra · OpenAI (o mais capaz da OpenAI)' },
  { id: openai('gpt-6.1-sol'), label: 'GPT-6.1 Sol · OpenAI (quase o Astra, mais barato)' },
  { id: openai('gpt-6-luna'), label: 'GPT-6 Luna · OpenAI (o mais barato da OpenAI)' },
  { id: DEFAULT_MODELS.tutor, label: 'Llama 3.3 70B · Workers AI (grátis)' },
];

type ModelRole = 'tutor' | 'tutorFallback' | 'asr' | 'tts';

const MODEL_OPTIONS: Record<ModelRole, readonly ModelOption[]> = {
  tutor: CHAT_MODELS.map((m) =>
    m.id === anthropic('claude-opus-5-5')
      ? { ...m, tag: 'quality' as const }
      : m.id === anthropic('claude-sonnet-5-5')
        ? { ...m, tag: 'value' as const }
        : m,
  ),
  tutorFallback: [
    ...CHAT_MODELS.map((m) =>
      m.id === anthropic('claude-sonnet-5-5')
        ? { ...m, tag: 'quality' as const }
        : m.id === DEFAULT_MODELS.tutor
          ? { ...m, label: 'Llama 3.3 70B · Workers AI (grátis, não depende de chave)', tag: 'value' as const }
          : m,
    ),
    { id: DEFAULT_MODELS.tutorFallback, label: 'Llama 3.1 8B · Workers AI (grátis, mais simples)' },
  ],
  asr: [
    { id: openai('gpt-transcribe'), label: 'gpt-transcribe · OpenAI (a mais precisa)', tag: 'quality' },
    { id: DEFAULT_MODELS.asr, label: 'Whisper large v3 turbo · Workers AI (grátis)', tag: 'value' },
  ],
  tts: [
    { id: TTS_ELEVEN, label: 'ElevenLabs · vozes dos personagens em todo o app', tag: 'quality' },
    { id: DEFAULT_MODELS.tts, label: 'Deepgram Aura · Workers AI (grátis)', tag: 'value' },
  ],
};

const MODEL_ROWS: readonly (readonly [ModelRole, string, string, string])[] = [
  [
    'tutor',
    SETTINGS.modelTutor,
    'Modelo da conversa',
    'Conversa do Mic, correções, relatório e rascunho das avaliações da temporada.',
  ],
  ['tutorFallback', SETTINGS.modelTutorFallback, 'Modelo reserva da conversa', 'Usado quando o principal falha.'],
  ['asr', SETTINGS.modelAsr, 'Modelo de transcrição', 'Ouve o aluno no Mic. O Claude não transcreve áudio.'],
  [
    'tts',
    SETTINGS.modelTts,
    'Modelo de voz',
    'ElevenLabs: todo áudio do app com as vozes de Configurações → Vozes (sem voz própria, a voz padrão das aulas). Workers AI: ElevenLabs só onde houver voz definida.',
  ],
];

type Keys = Record<AiProviderName, boolean>;
/** Models each provider's key can use (ids without the provider prefix), once tested. */
type Available = Partial<Record<AiProviderName, readonly string[]>>;

/** ElevenLabs runs outside the AI providers: it counts as Workers AI here (no Anthropic/OpenAI key). */
const providerOf = (model: string): AiProvider => (model === TTS_ELEVEN ? 'workers' : aiProviderOf(model));

function ProviderKey({
  p,
  models,
  onSaved,
  onModels,
}: {
  p: AiProviderKey;
  models: readonly string[] | null;
  onSaved: (providers: AiProviderKey[]) => void;
  onModels: (models: string[]) => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const id = `aik-${p.provider}`;
  const name = PROVIDER_NAME[p.provider];
  const test = async (quiet = false) => {
    setBusy('test');
    try {
      const res = await call(adminAiProvidersApi.test, { body: { provider: p.provider } });
      if (res.ok) {
        onModels(res.models);
        if (!quiet) toast(`Chave da ${name} funcionando: ${res.models.length} modelos disponíveis.`);
      } else toast(res.error ?? 'A chave não funcionou.', 'err');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      onSaved((await call(adminAiProvidersApi.put, { body: { [p.provider]: key.trim() } })).providers);
      setKey('');
      toast(`Chave da ${name} salva.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
      setBusy('');
      return;
    }
    await test(true);
  };
  return (
    <div class="stack" style={{ '--gap': '8px' }}>
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        <strong>{name}</strong>
        {p.keySet ? (
          <Pill label={`Chave salva · termina em ${p.keyHint}`} tone="gr" icon="check" />
        ) : (
          <Pill label="Sem chave" tone="gold" />
        )}
        {p.keySource === 'env' ? <Pill label="vinda da variável do Worker" /> : null}
        {models ? <Pill label={`${models.length} modelos liberados`} tone="bl" /> : null}
        {p.updatedAt ? <span class="xs">Alterado {fmtAgo(p.updatedAt)}</span> : null}
      </div>
      <form
        class="ad-grid"
        style={{ alignItems: 'end' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim().length >= 20) void save();
        }}
      >
        <Field id={id} label={p.keySet ? 'Trocar a chave da API' : 'Chave da API'} hint={PROVIDER_HINT[p.provider]}>
          <TextIn
            id={id}
            type="password"
            autocomplete="off"
            spellcheck={false}
            value={key}
            onValue={setKey}
            placeholder={p.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
            maxLength={300}
          />
        </Field>
        <div class="row wrapx" style={{ '--gap': '8px', paddingBottom: '22px' }}>
          <Button
            label="Salvar"
            icon="check"
            type="submit"
            busy={busy === 'save'}
            disabled={key.trim().length < 20 || !!busy}
          />
          <Button
            label="Testar chave"
            icon="refresh"
            kind="light"
            busy={busy === 'test'}
            disabled={!p.keySet || !!busy}
            onClick={() => void test()}
          />
          {p.keySet && p.keySource === 'settings' ? (
            <Button
              label="Remover"
              icon="trash"
              kind="ghost"
              onClick={() =>
                void confirmAction({
                  title: `Remover a chave da ${name}?`,
                  body: 'Os modelos deste provedor deixam de responder; a conversa passa para o modelo reserva e, sem ele, para o modo demo.',
                  confirm: 'Remover chave',
                  danger: true,
                  run: () =>
                    call(adminAiProvidersApi.put, { body: { [p.provider]: null } }).then((r) => onSaved(r.providers)),
                }).then((ok) => {
                  if (ok) toast('Chave removida.');
                })
              }
            />
          ) : null}
        </div>
      </form>
    </div>
  );
}

function ModelRow({
  role,
  k,
  label,
  hint,
  s,
  keys,
  available,
  onSaved,
}: {
  role: ModelRole;
  k: string;
  label: string;
  hint: string;
  s?: AppSetting;
  keys: Keys;
  available: Available;
  onSaved: (s: AppSetting) => void;
}) {
  const current = s?.value?.trim() || DEFAULT_MODELS[role];
  const [v, setV] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(current), [current]);
  const allowed = (id: string) => {
    const p = providerOf(id);
    if (p === 'workers') return true;
    const list = available[p];
    return !list || list.includes(id.slice(p.length + 1));
  };
  const options: (readonly [string, string])[] = [...MODEL_OPTIONS[role]]
    .filter((m) => m.id === current || allowed(m.id))
    .sort((a, b) => TAG_ORDER[a.tag ?? 'none'] - TAG_ORDER[b.tag ?? 'none'])
    .map((m) => [m.id, `${m.tag ? TAG_PREFIX[m.tag] : ''}${m.label}`] as const);
  if (!options.some(([id]) => id === current)) options.push([current, `${current} · atual`]);
  const provider = providerOf(v);
  const missing = provider === 'workers' || keys[provider] ? null : PROVIDER_NAME[provider];
  const id = `aim-${role}`;
  const save = async () => {
    setBusy(true);
    try {
      onSaved((await call(adminOpsApi.setSetting, { params: { key: k }, body: { value: v } })).item);
      toast(`${label}: salvo. O app passa a usar em até 30 segundos.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="ad-grid" style={{ alignItems: 'end' }}>
      <Field
        id={id}
        label={label}
        hint={missing ? `Salve a chave da ${missing} antes.` : hint}
        err={missing ? `Sem chave da ${missing}.` : null}
      >
        <Sel id={id} value={v} onValue={setV} options={options} />
      </Field>
      <div class="row" style={{ '--gap': '8px', paddingBottom: '22px' }}>
        <Button
          label="Salvar"
          icon="check"
          kind="light"
          busy={busy}
          disabled={v === current || !!missing}
          onClick={() => void save()}
        />
        <span class="xs ad-mono">{s ? `mudou ${fmtAgo(s.updatedAt)}` : 'padrão'}</span>
      </div>
    </div>
  );
}

/** Times one short Mic-like turn on every conversation model with a key, one after the other. */
function SpeedTest({ keys, available }: { keys: Keys; available: Available }) {
  const [results, setResults] = useState<AiSpeedRes[]>([]);
  const [running, setRunning] = useState(false);
  const models = CHAT_MODELS.filter((m) => {
    const p = aiProviderOf(m.id);
    if (p === 'workers') return true;
    if (!keys[p]) return false;
    const list = available[p];
    return !list || list.includes(m.id.slice(p.length + 1));
  });
  const run = async () => {
    setRunning(true);
    setResults([]);
    try {
      for (const m of models) {
        let r: AiSpeedRes;
        try {
          r = await call(adminAiProvidersApi.speed, { body: { model: m.id } });
        } catch (e) {
          r = { model: m.id, ok: false, ms: 0, error: errorMessage(e) };
        }
        setResults((p) => [...p, r]);
      }
    } finally {
      setRunning(false);
    }
  };
  const short = (id: string) => CHAT_MODELS.find((m) => m.id === id)?.label.split(' (')[0] ?? id;
  const sorted = [...results].sort((a, b) => (a.ok === b.ok ? a.ms - b.ms : a.ok ? -1 : 1));
  const fastest = sorted.find((r) => r.ok)?.model;
  return (
    <div class="stack" style={{ '--gap': '8px' }}>
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        <Button
          label={running ? `Medindo… (${results.length}/${models.length})` : 'Medir velocidade dos modelos'}
          icon="refresh"
          kind="light"
          busy={running}
          disabled={running}
          onClick={() => void run()}
        />
        <span class="xs">
          Manda a mesma fala curta do Mic para cada modelo da conversa com chave e mostra quanto o aluno esperaria.
        </span>
      </div>
      {sorted.length ? (
        <div class="stack" style={{ '--gap': '4px' }}>
          {sorted.map((r) => (
            <div key={r.model} class="row between" style={{ '--gap': '8px' }}>
              <span>
                {r.model === fastest ? '⚡ ' : ''}
                {short(r.model)}
              </span>
              {r.ok ? (
                <Pill
                  label={`${(r.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`}
                  tone={r.ms < 2500 ? 'gr' : r.ms < 6000 ? 'gold' : ''}
                />
              ) : (
                <span class="xs">{r.error}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AiProviders({ settings, onSetting }: { settings: readonly AppSetting[]; onSetting: (s: AppSetting) => void }) {
  const load = useLoad((signal) => call(adminAiProvidersApi.get, { signal }), []);
  const [available, setAvailable] = useState<Available>({});
  // A stored key is tested once on open, so the model lists only offer what it can use.
  useEffect(() => {
    for (const p of load.data?.providers ?? []) {
      if (!p.keySet || available[p.provider]) continue;
      call(adminAiProvidersApi.test, { body: { provider: p.provider } })
        .then((r) => {
          if (r.ok) setAvailable((a) => ({ ...a, [p.provider]: r.models }));
        })
        .catch(() => undefined);
    }
  }, [load.data]);
  return (
    <Card
      title="Provedores de IA"
      sub="O app usa o Workers AI da Cloudflare (grátis) por padrão. Com a chave da Anthropic ou da OpenAI, a conversa e a transcrição podem rodar nos modelos pagos delas. A voz pode ser a da ElevenLabs (chave em Vozes). A checagem de segurança continua no Workers AI."
    >
      <Async load={load}>
        {(d) => {
          const keys: Keys = {
            anthropic: !!d.providers.find((p) => p.provider === 'anthropic')?.keySet,
            openai: !!d.providers.find((p) => p.provider === 'openai')?.keySet,
          };
          return (
            <div class="stack" style={{ '--gap': '18px' }}>
              {d.providers.map((p) => (
                <ProviderKey
                  key={p.provider}
                  p={p}
                  models={available[p.provider] ?? null}
                  onSaved={(providers) => load.setData(() => ({ providers }))}
                  onModels={(models) => setAvailable((a) => ({ ...a, [p.provider]: models }))}
                />
              ))}
              <div class="ad-note bl">
                Cada lista só traz modelos que fazem aquela tarefa. ⭐ marca o de melhor qualidade e 💰 o de melhor
                qualidade pelo preço. Na reserva, prefira outro provedor que o principal (o Llama 3.3 70B é grátis e não
                depende de chave): se o principal falhar ou ficar sem créditos, o aluno segue conversando.
              </div>
              {MODEL_ROWS.map(([role, k, label, hint]) => (
                <ModelRow
                  key={role}
                  role={role}
                  k={k}
                  label={label}
                  hint={hint}
                  s={settings.find((x) => x.key === k)}
                  keys={keys}
                  available={available}
                  onSaved={onSetting}
                />
              ))}
              <SpeedTest keys={keys} available={available} />
            </div>
          );
        }}
      </Async>
    </Card>
  );
}

// ---------- Voices (PROD spec 05 "Lesson voices") ----------

const ELEVEN_MODEL_LABEL: Record<ElevenModel, string> = {
  eleven_turbo_v2_5: 'Turbo v2.5 (rápido, recomendado)',
  eleven_flash_v2_5: 'Flash v2.5 (o mais rápido)',
  eleven_multilingual_v2: 'Multilingual v2 (mais natural, mais lento)',
};

/** fetch for the multipart / binary voice endpoints, with the same error envelope as call(). */
async function rawFetch(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: 'same-origin' });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (res.ok) return res;
  const data: unknown = await res.json().catch(() => null);
  throw isErrorEnvelope(data)
    ? new ApiError(data.error.code, data.error.message, data.error.details)
    : new ApiError('internal');
}

function ElevenCard({ s, onSaved }: { s: VoiceSettings; onSaved: (s: VoiceSettings) => void }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState<ElevenModel>(s.model);
  const [busy, setBusy] = useState(false);
  useEffect(() => setModel(s.model), [s.model]);
  const save = async (body: VoiceSettingsBody) => {
    setBusy(true);
    try {
      onSaved((await call(adminVoicesApi.put, { body })).settings);
      setKey('');
      toast('Configuração de voz salva.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  const k = key.trim();
  return (
    <Card
      title="ElevenLabs"
      sub="Com a chave e uma voz clonada, cada personagem fala com a própria voz no app inteiro (Mic, diálogos, vocabulário). Sem elas, usa a voz padrão da IA."
    >
      <div class="stack" style={{ '--gap': '12px' }}>
        <div class="row wrapx" style={{ '--gap': '8px' }}>
          {s.keySet ? (
            <Pill label={`Chave salva · termina em ${s.keyHint}`} tone="gr" icon="check" />
          ) : (
            <Pill label="Sem chave" tone="gold" />
          )}
          {s.keySource === 'env' ? <Pill label="vinda da variável do Worker" /> : null}
          {s.updatedAt ? <span class="xs">Alterado {fmtAgo(s.updatedAt)}</span> : null}
        </div>
        <div class="ad-grid">
          <Field
            id="el-key"
            label={s.keySet ? 'Trocar a chave da API' : 'Chave da API'}
            hint="ElevenLabs → Developers → API Keys. Dê acesso a Text to Speech e Voices. A chave fica cifrada e nunca é mostrada de novo."
          >
            <TextIn
              id="el-key"
              type="password"
              autocomplete="off"
              spellcheck={false}
              value={key}
              onValue={setKey}
              placeholder="sk_…"
              maxLength={200}
            />
          </Field>
          <Field id="el-model" label="Modelo">
            <Sel
              id="el-model"
              value={model}
              onValue={(v) => setModel(v as ElevenModel)}
              options={ELEVEN_MODELS.map((m) => [m, ELEVEN_MODEL_LABEL[m]] as const)}
            />
          </Field>
        </div>
        <div class="row wrapx" style={{ '--gap': '8px' }}>
          <Button
            label="Salvar"
            icon="check"
            busy={busy}
            disabled={(!k || k.length < 20) && model === s.model}
            onClick={() => void save({ ...(k ? { apiKey: k } : {}), ...(model === s.model ? {} : { model }) })}
          />
          {s.keySet && s.keySource === 'settings' ? (
            <Button
              label="Remover chave"
              icon="trash"
              kind="ghost"
              onClick={() =>
                void confirmAction({
                  title: 'Remover a chave da ElevenLabs?',
                  body: 'As assistentes voltam para a voz padrão (Workers AI) até uma nova chave ser salva.',
                  confirm: 'Remover chave',
                  danger: true,
                  run: () => call(adminVoicesApi.put, { body: { apiKey: null } }).then((r) => onSaved(r.settings)),
                }).then((ok) => {
                  if (ok) toast('Chave removida.');
                })
              }
            />
          ) : null}
          {k && k.length < 20 ? <span class="xs">A chave parece curta demais.</span> : null}
        </div>
      </div>
    </Card>
  );
}

function VoiceRow({
  a,
  note,
  s,
  onSaved,
}: {
  a: { key: string; name: string };
  note?: string;
  s: VoiceSettings;
  onSaved: (s: VoiceSettings) => void;
}) {
  const saved = s.voices[a.key] ?? '';
  const [v, setV] = useState(saved);
  const [busy, setBusy] = useState<'' | 'save' | 'clone' | 'test'>('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => setV(saved), [saved]);
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);
  const id = `voice-${a.key}`;
  const save = async (voiceId: string | null) => {
    setBusy('save');
    try {
      onSaved((await call(adminVoicesApi.put, { body: { voices: { [a.key]: voiceId } } })).settings);
      toast(voiceId ? `Voz de ${a.name} salva.` : `${a.name} volta para a voz padrão.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy('');
    }
  };
  const clone = async (file: File) => {
    setBusy('clone');
    try {
      const form = new FormData();
      form.append('assistantKey', a.key);
      form.append('file', file, file.name);
      const res = await rawFetch(urlFor(adminVoicesApi.clone), { method: 'POST', body: form });
      onSaved(((await res.json()) as { settings: VoiceSettings }).settings);
      toast(`Voz de ${a.name} clonada. Teste antes de usar com os alunos.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const test = async () => {
    setBusy('test');
    try {
      const res = await rawFetch(urlFor(adminVoicesApi.test), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantKey: a.key }),
      });
      setAudioUrl(URL.createObjectURL(await res.blob()));
      queueMicrotask(() => void audioRef.current?.play().catch(() => undefined));
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy('');
    }
  };
  const dirty = v.trim() !== saved;
  const generic = a.key === ELEVEN_NARRATOR_KEY || a.key === ELEVEN_DEFAULT_KEY || a.key === ELEVEN_EXTRAS_KEY;
  return (
    <li class="stack" style={{ '--gap': '8px', padding: '12px 0', borderTop: '1.5px solid var(--line)' }}>
      <div class="row wrapx between" style={{ '--gap': '8px' }}>
        <b>{a.name}</b>
        {note ? (
          <span class="xs" style={{ flexBasis: '100%' }}>
            {note}
          </span>
        ) : null}
        {saved ? <Pill label="Voz clonada" tone="gr" icon="check" /> : <Pill label="Voz padrão" />}
      </div>
      <div class="row wrapx" style={{ '--gap': '8px', alignItems: 'flex-end' }}>
        <Field id={id} label="Voz na ElevenLabs" cls="grow">
          <VoicePicker
            id={id}
            value={v.trim() || null}
            onValue={(x) => setV(x ?? '')}
            emptyLabel="Voz padrão (sem ElevenLabs)"
          />
        </Field>
        <Field id={`${id}-raw`} label="ou cole o ID">
          <TextIn
            id={`${id}-raw`}
            value={v}
            onValue={setV}
            spellcheck={false}
            maxLength={40}
            placeholder="21m00Tcm4TlvDq8ikWAM"
          />
        </Field>
        <Button
          label="Salvar ID"
          kind="light"
          busy={busy === 'save'}
          disabled={!dirty || !!busy}
          onClick={() => void save(v.trim() || null)}
        />
        <Button
          label="Clonar voz…"
          icon="upload"
          kind="light"
          busy={busy === 'clone'}
          disabled={!s.keySet || !!busy}
          title={s.keySet ? 'Enviar uma amostra de áudio da voz' : 'Salve a chave antes'}
          onClick={() => fileRef.current?.click()}
        />
        <Button
          label="Testar"
          icon="play"
          kind="light"
          busy={busy === 'test'}
          disabled={!s.keySet || !saved || !!busy}
          onClick={() => void test()}
        />
        {saved ? (
          <Button
            ariaLabel={`Voltar ${a.name} para a voz padrão`}
            title="Usar a voz padrão"
            icon="trash"
            kind="ghost"
            onClick={() => void save(null)}
          />
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,.mp3,.wav,.m4a,.ogg,.webm"
        hidden
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void clone(f);
        }}
      />
      {audioUrl ? (
        <div class="stack" style={{ '--gap': '4px' }}>
          {/* biome-ignore lint/a11y/useMediaCaption: a generated voice sample; its line is printed below. */}
          <audio ref={audioRef} src={audioUrl} controls preload="auto" style={{ width: '100%' }} />
          <span class="xs">
            {generic
              ? '"Good morning! Kitchen, window, table, coffee. Nice to meet you."'
              : `"Hi! I'm ${a.name}. Let's practice a little English together today."`}
          </span>
        </div>
      ) : null}
    </li>
  );
}

function Voices() {
  const load = useLoad((signal) => call(adminVoicesApi.get, { signal }), []);
  const [s, setS] = useState<VoiceSettings | null>(null);
  useEffect(() => {
    if (load.data) setS(load.data.settings);
  }, [load.data]);
  return (
    <Async load={load}>
      {() =>
        s ? (
          <>
            <ElevenCard s={s} onSaved={setS} />
            <Card
              title="Vozes do curso"
              sub="A voz de cada personagem e a da narração no curso inteiro. Escolha uma voz da conta ElevenLabs, busque na biblioteca, cole o ID ou clone a partir de uma amostra (1 a 3 minutos de fala limpa, MP3 ou WAV até 10 MB). Cada lição pode trocar estas vozes no editor do episódio (Geral → Vozes desta lição)."
            >
              <ul class="stack" style={{ '--gap': '0', listStyle: 'none', margin: 0, padding: 0 }}>
                <VoiceRow
                  a={{ key: ELEVEN_DEFAULT_KEY, name: 'Voz padrão das aulas' }}
                  note="Toca em tudo da aula que não tem voz definida (personagem sem voz, narração sem voz, etapa sem voz) e entra no lugar de uma voz que falhar. Sem ela, toca a voz genérica da IA."
                  s={s}
                  onSaved={setS}
                />
                <VoiceRow a={{ key: ELEVEN_NARRATOR_KEY, name: 'Narração do curso' }} s={s} onSaved={setS} />
                <VoiceRow
                  a={{ key: ELEVEN_EXTRAS_KEY, name: 'Voz dos extras' }}
                  note="Fala nos Take Some Extras de todos os episódios (Take the Lead e os outros). Cada episódio pode trocar, e dar uma voz a cada personagem, em Take Some Extras → Vozes dos extras. Sem ela, cada personagem fala com a própria voz do curso."
                  s={s}
                  onSaved={setS}
                />
                {s.assistants.map((a) => (
                  <VoiceRow key={a.key} a={a} s={s} onSaved={setS} />
                ))}
              </ul>
              <p class="xs" style={{ marginTop: '10px' }}>
                <Icon name="mic" size={14} /> A amostra da Margaret está em{' '}
                <code class="ad-mono">prototipo/personagens/Margaret/voz.mp3</code>. Clonar usa créditos e o plano da
                sua conta ElevenLabs (Instant Voice Clone, plano Starter ou acima).
              </p>
            </Card>
          </>
        ) : null
      }
    </Async>
  );
}

// ---------- Flags ----------

function RulesModal({
  flag,
  onClose,
  onSaved,
}: {
  flag: FeatureFlag;
  onClose: () => void;
  onSaved: (f: FeatureFlag) => void;
}) {
  const r = (flag.rules ?? {}) as { users?: string[]; plans?: string[]; roles?: string[] };
  const [users, setUsers] = useState((r.users ?? []).join('\n'));
  const [plans, setPlans] = useState((r.plans ?? []).join('\n'));
  const [roles, setRoles] = useState((r.roles ?? []).join('\n'));
  const [pct, setPct] = useState(String(flag.rolloutPct));
  const [busy, setBusy] = useState(false);
  const lines = (s: string) =>
    s
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  const save = async () => {
    setBusy(true);
    try {
      const rules = { users: lines(users), plans: lines(plans), roles: lines(roles) };
      const empty = !rules.users.length && !rules.plans.length && !rules.roles.length;
      const res = await call(adminOpsApi.setFlag, {
        params: { key: flag.key },
        body: {
          enabled: flag.enabled,
          rolloutPct: Math.max(0, Math.min(100, Number.parseInt(pct || '0', 10))),
          rules: empty ? null : rules,
        },
      });
      onSaved(res.item);
      toast('Flag salva.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Regras de ${flag.key}`}
      onClose={onClose}
      locked={busy}
      foot={
        <>
          <Button label="Cancelar" kind="light" onClick={onClose} />
          <Button label="Salvar" icon="check" busy={busy} onClick={() => void save()} />
        </>
      }
    >
      <Field
        id="fl-pct"
        label="Liberação gradual (%)"
        hint="Percentual de alunos que recebem a flag ligada. As listas abaixo recebem sempre."
      >
        <TextIn id="fl-pct" type="number" min={0} max={100} value={pct} onValue={setPct} />
      </Field>
      <Field id="fl-users" label="Ids de usuários" opt hint="Um por linha.">
        <Area id="fl-users" value={users} onValue={setUsers} rows={3} mono />
      </Field>
      <Field id="fl-plans" label="Planos (slug)" opt>
        <Area id="fl-plans" value={plans} onValue={setPlans} rows={2} mono />
      </Field>
      <Field id="fl-roles" label="Papéis" opt hint="super_admin, admin, editor, moderator.">
        <Area id="fl-roles" value={roles} onValue={setRoles} rows={2} mono />
      </Field>
    </Modal>
  );
}

function Flags() {
  const load = useLoad((signal) => call(adminOpsApi.flags, { signal }), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [rules, setRules] = useState<FeatureFlag | null>(null);
  const [newKey, setNewKey] = useState('');
  const email = useEmails(load.data?.items.map((f) => f.updatedBy) ?? []);
  const put = (f: FeatureFlag) =>
    load.setData((p) => ({
      items: [...(p?.items ?? []).filter((x) => x.key !== f.key), f].sort((a, b) => a.key.localeCompare(b.key)),
    }));
  const toggle = async (key: string, enabled: boolean) => {
    setBusy(key);
    try {
      put((await call(adminOpsApi.setFlag, { params: { key }, body: { enabled } })).item);
      toast(enabled ? `${key} ligada.` : `${key} desligada.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(null);
    }
  };
  const known = Object.values(FLAGS) as string[];
  return (
    <Card
      title="Flags"
      sub="Mudam o comportamento do app sem nova versão. Cada isolate do Worker vê a mudança em até 30 s."
    >
      <Async load={load}>
        {(d) => {
          const keys = [...new Set([...known, ...d.items.map((f) => f.key)])];
          return (
            <ul class="ad-flags">
              {keys.map((key) => {
                const f = d.items.find((x) => x.key === key);
                const r = (f?.rules ?? null) as { users?: string[]; plans?: string[]; roles?: string[] } | null;
                const nRules = (r?.users?.length ?? 0) + (r?.plans?.length ?? 0) + (r?.roles?.length ?? 0);
                return (
                  <li key={key} class="ad-flag">
                    <Switch
                      id={`flag-${key}`}
                      on={!!f?.enabled}
                      label={key}
                      disabled={busy === key}
                      onChange={(v) => void toggle(key, v)}
                    />
                    <label for={`flag-${key}`} class="ad-flag-t">
                      <span class="ad-bool-l ad-mono">{key}</span>
                      <span class="sm">{FLAG_INFO[key] ?? 'Flag personalizada.'}</span>
                      <span class="xs">
                        {f
                          ? `${f.rolloutPct}% dos alunos${nRules ? ` + ${nRules} na lista` : ''} · mudou ${fmtAgo(f.updatedAt)}${f.updatedBy ? ` por ${email(f.updatedBy) ?? 'alguém'}` : ''}`
                          : 'Ainda não criada (desligada)'}
                      </span>
                    </label>
                    {f ? (
                      <span class="ad-flag-a">
                        <Button label="Regras" icon="sliders" kind="light" onClick={() => setRules(f)} />
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          );
        }}
      </Async>
      <form
        class="ad-inlineform"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[a-z][a-z0-9_.-]{0,79}$/.test(newKey)) {
            void toggle(newKey, false);
            setNewKey('');
          }
        }}
      >
        <Field id="flag-new" label="Nova flag">
          <TextIn
            id="flag-new"
            class="ad-mono"
            value={newKey}
            onValue={(v) => setNewKey(v.toLowerCase())}
            placeholder="ex.: mic.novo_modo"
            aria-describedby="flag-new-hint"
          />
        </Field>
        <Button
          label="Criar flag"
          icon="plus"
          kind="light"
          type="submit"
          disabled={!/^[a-z][a-z0-9_.-]{0,79}$/.test(newKey)}
        />
      </form>
      <p class="xs" id="flag-new-hint">
        Minúsculas, números, ponto, hífen ou _. A flag nova nasce desligada.
      </p>
      {rules ? (
        <RulesModal
          flag={rules}
          onClose={() => setRules(null)}
          onSaved={(f) => {
            put(f);
            setRules(null);
          }}
        />
      ) : null}
    </Card>
  );
}

// ---------- Settings ----------

function SettingRow({
  k,
  label,
  hint,
  s,
  onSaved,
}: {
  k: string;
  label: string;
  hint: string;
  s?: AppSetting;
  onSaved: (s: AppSetting) => void;
}) {
  const [v, setV] = useState(s?.value ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(s?.value ?? ''), [s?.value]);
  const id = `set-${k.replace(/\W/g, '-')}`;
  const save = async () => {
    setBusy(true);
    try {
      onSaved((await call(adminOpsApi.setSetting, { params: { key: k }, body: { value: v.trim() } })).item);
      toast('Configuração salva.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      class="ad-grid"
      style={{ alignItems: 'end' }}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field id={id} label={label} hint={`${hint}${s ? ` · mudou ${fmtAgo(s.updatedAt)}` : ' · usando o padrão'}`}>
        <TextIn id={id} class="ad-mono" value={v} onValue={setV} placeholder="(padrão)" />
      </Field>
      <div class="row" style={{ '--gap': '8px', paddingBottom: '22px' }}>
        <Button
          label="Salvar"
          icon="check"
          kind="light"
          type="submit"
          busy={busy}
          disabled={!v.trim() || v.trim() === (s?.value ?? '')}
        />
        <span class="xs ad-mono">{k}</span>
      </div>
    </form>
  );
}

function AppSettings() {
  const load = useLoad((signal) => call(adminOpsApi.settings, { signal }), []);
  const current = load.data?.items.find((s) => s.key === SETTINGS.contentCurrent);
  const put = (s: AppSetting) =>
    load.setData((p) => ({ items: [...(p?.items ?? []).filter((x) => x.key !== s.key), s] }));
  return (
    <>
      <AiProviders settings={load.data?.items ?? []} onSetting={put} />
      <Card title="Valores do app" sub="O que o Worker lê a cada pedido. Vazio = o padrão do código.">
        {current ? (
          <div class="ad-note bl">
            <Icon name="rocket" size={18} /> Versão publicada: <code class="ad-mono">{current.value.slice(0, 12)}</code>{' '}
            desde {fmtDateTime(current.updatedAt)}. Ela muda sozinha a cada conteúdo salvo.
          </div>
        ) : null}
        <Async load={load}>
          {(d) => (
            <div class="stack" style={{ '--gap': '6px' }}>
              {SETTING_INFO.map(([k, label, hint]) => (
                <SettingRow
                  key={k}
                  k={k}
                  label={label}
                  hint={hint}
                  s={d.items.find((x) => x.key === k)}
                  onSaved={put}
                />
              ))}
            </div>
          )}
        </Async>
      </Card>
    </>
  );
}

// ---------- Prompts ----------

function Prompts() {
  const load = useLoad((signal) => call(adminAiApi.prompts, { signal }), []);
  const [sel, setSel] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const email = useEmails(load.data?.items.map((p) => p.updatedBy) ?? []);
  const items = load.data?.items ?? [];
  const cur: PromptRow | undefined = items.find((p) => p.key === sel) ?? items[0];
  useEffect(() => {
    if (cur) {
      setSel(cur.key);
      setText(cur.template);
    }
  }, [cur?.key, cur?.version]);
  const save = async () => {
    if (!cur) return;
    setBusy(true);
    try {
      const res = await call(adminAiApi.setPrompt, {
        params: { key: cur.key },
        body: { template: text, expectedVersion: cur.version },
      });
      load.setData((p) => ({ items: (p?.items ?? []).map((x) => (x.key === res.item.key ? res.item : x)) }));
      toast(`Prompt salvo (versão ${res.item.version}).`);
    } catch (e) {
      toast(
        isCode(e, 'conflict') ? 'Alguém salvou este prompt antes. Recarregue para ver a versão nova.' : errorMessage(e),
        'err',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Prompts da IA" sub="Modelos das instruções. Valem na hora para as próximas chamadas.">
      <Async load={load}>
        {() =>
          !cur ? (
            <Empty icon="chat" title="Nenhum prompt." />
          ) : (
            <>
              <div class="row wrapx" style={{ '--gap': '10px' }}>
                <Sel
                  ariaLabel="Prompt"
                  value={cur.key}
                  onValue={setSel}
                  options={items.map((p) => [p.key, PROMPT_INFO[p.key] ?? p.key] as const)}
                  cls="ad-grow"
                />
                <Pill label={`versão ${cur.version}`} tone="navy" />
                <span class="xs">
                  {fmtAgo(cur.updatedAt)}
                  {cur.updatedBy ? ` por ${email(cur.updatedBy) ?? 'alguém'}` : ''}
                </span>
              </div>
              <Field
                id="prompt-t"
                label="Modelo"
                hint={`${text.length} caracteres. As variáveis entre chaves são preenchidas pelo servidor.`}
              >
                <Area id="prompt-t" value={text} onValue={setText} rows={16} mono maxLength={20000} />
              </Field>
              <div class="row" style={{ '--gap': '8px' }}>
                <Button
                  label="Salvar nova versão"
                  icon="check"
                  busy={busy}
                  disabled={text === cur.template || !text.trim()}
                  onClick={() => void save()}
                />
                <Button
                  label="Descartar"
                  kind="light"
                  disabled={text === cur.template || busy}
                  onClick={() => setText(cur.template)}
                />
                <Button label="Recarregar" kind="link" onClick={load.reload} />
              </div>
            </>
          )
        }
      </Async>
    </Card>
  );
}

export function Settings({ q }: ScreenProps) {
  const tabs = [
    ...(can('flags.manage') ? ([['flags', 'Flags']] as const) : []),
    ...(can('settings.manage') ? ([['app', 'Valores do app']] as const) : []),
    ...(can('settings.manage') ? ([['vozes', 'Vozes']] as const) : []),
    ...(can('ai.prompts') ? ([['prompts', 'Prompts da IA']] as const) : []),
    ...(can('api_tokens.manage') ? ([['integracoes', 'Integrações']] as const) : []),
  ];
  const tab = tabs.some(([t]) => t === q.aba) ? (q.aba as string) : (tabs[0]?.[0] ?? 'flags');
  return (
    <Page
      title="Configurações"
      kicker="Operação"
      bar={
        tabs.length > 1 ? (
          <TabsNav label="Partes das configurações">
            {tabs.map(([t, l]) => (
              <a
                key={t}
                href={`#/config?aba=${t}`}
                class={`ad-tab${t === tab ? ' on' : ''}`}
                aria-current={t === tab ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setQuery({ aba: t });
                }}
              >
                {l}
              </a>
            ))}
          </TabsNav>
        ) : undefined
      }
    >
      {tab === 'flags' ? (
        <Flags />
      ) : tab === 'app' ? (
        <AppSettings />
      ) : tab === 'vozes' ? (
        <Voices />
      ) : tab === 'integracoes' ? (
        <ApiTokens />
      ) : (
        <Prompts />
      )}
    </Page>
  );
}
