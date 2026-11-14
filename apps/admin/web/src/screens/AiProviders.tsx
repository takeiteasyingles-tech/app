// Configurações → App → Provedores de IA. PROD (spec 05 "Paid AI providers"): the Claude (Anthropic)
// and OpenAI API keys (sealed on the server, write-only) and the models the app runs: the conversation,
// its fallback and the transcription may run on Workers AI, Claude or OpenAI; the voice on ElevenLabs
// (TTS_ELEVEN) or Workers AI. The safety check (Llama Guard) stays on Workers AI.
import {
  aiProviderOf,
  type CLAUDE_MODELS,
  DEFAULT_MODELS,
  type OPENAI_ASR_MODELS,
  type OPENAI_MODELS,
  SETTINGS,
  TTS_ELEVEN,
} from '@tie/shared/constants';
import { type AppSetting, adminOpsApi } from '@tie/shared/contracts/admin';
import {
  type AiProviderKey,
  type AiProviderName,
  type AiSpeedRes,
  adminAiProvidersApi,
} from '@tie/shared/contracts/aiProviders';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../api';
import { fmtAgo } from '../format';
import { useLoad } from '../ui/async';
import { Async, Button, Card, Field, Pill, Sel, TextIn } from '../ui/kit';
import { confirmAction } from '../ui/modal';
import { toast } from '../ui/toast';

const NAME: Record<AiProviderName, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI' };
const KEY_HINT: Record<AiProviderName, string> = {
  anthropic: 'console.anthropic.com → API Keys. A chave fica cifrada e nunca é mostrada de novo.',
  openai: 'platform.openai.com → API keys. A chave fica cifrada e nunca é mostrada de novo.',
};
type Tag = 'quality' | 'value';
const TAG_TEXT: Record<Tag, string> = {
  quality: '⭐ Melhor qualidade · ',
  value: '💰 Melhor custo-benefício · ',
};
interface Choice {
  id: string;
  label: string;
  tag?: Tag;
}
const claude = (m: (typeof CLAUDE_MODELS)[number]) => `anthropic:${m}`;
const gpt = (m: (typeof OPENAI_MODELS)[number] | (typeof OPENAI_ASR_MODELS)[number]) => `openai:${m}`;
/** The conversation models: chat models good enough to tutor, correct and write the report. */
const CHAT: readonly Choice[] = [
  {
    id: claude('claude-opus-5-5'),
    label: 'Claude Opus 5.5 · Anthropic (o mais capaz; pensa antes, responde mais devagar)',
  },
  { id: claude('claude-sonnet-5-5'), label: 'Claude Sonnet 5.5 · Anthropic (resposta rápida, ótimo em conversa)' },
  { id: claude('claude-haiku-5-5'), label: 'Claude Haiku 5.5 · Anthropic (o mais rápido e barato)' },
  { id: gpt('gpt-6-astra'), label: 'GPT-6 Astra · OpenAI (o mais capaz da OpenAI)' },
  { id: gpt('gpt-6.1-sol'), label: 'GPT-6.1 Sol · OpenAI (quase o Astra, mais barato)' },
  { id: gpt('gpt-6-luna'), label: 'GPT-6 Luna · OpenAI (o mais barato da OpenAI)' },
  { id: DEFAULT_MODELS.tutor, label: 'Llama 3.3 70B · Workers AI (grátis)' },
];
/**
 * Per role, only the models that do that job, with the best for quality and the best for quality per
 * price marked first. The fallback prefers another provider than the main one (free, no key needed).
 */
const CATALOG: Record<Role, readonly Choice[]> = {
  tutor: CHAT.map((c) =>
    c.id === claude('claude-opus-5-5')
      ? { ...c, tag: 'quality' }
      : c.id === claude('claude-sonnet-5-5')
        ? { ...c, tag: 'value' }
        : c,
  ),
  tutorFallback: [
    ...CHAT.map(
      (c): Choice =>
        c.id === claude('claude-sonnet-5-5')
          ? { ...c, tag: 'quality' }
          : c.id === DEFAULT_MODELS.tutor
            ? { ...c, label: 'Llama 3.3 70B · Workers AI (grátis, não depende de chave)', tag: 'value' }
            : c,
    ),
    { id: DEFAULT_MODELS.tutorFallback, label: 'Llama 3.1 8B · Workers AI (grátis, mais simples)' },
  ],
  asr: [
    { id: gpt('gpt-transcribe'), label: 'gpt-transcribe · OpenAI (a mais precisa)', tag: 'quality' },
    { id: DEFAULT_MODELS.asr, label: 'Whisper large v3 turbo · Workers AI (grátis)', tag: 'value' },
  ],
  tts: [
    { id: TTS_ELEVEN, label: 'ElevenLabs · vozes dos personagens em todo o app', tag: 'quality' },
    { id: DEFAULT_MODELS.tts, label: 'Deepgram Aura · Workers AI (grátis)', tag: 'value' },
  ],
};
const TAG_ORDER: Record<Tag | 'none', number> = { quality: 0, value: 1, none: 2 };

function ProviderRow({
  p,
  models,
  onSaved,
  onModels,
}: {
  p: AiProviderKey;
  models: string[] | null;
  onSaved: (list: AiProviderKey[]) => void;
  onModels: (list: string[]) => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const id = `aik-${p.provider}`;
  const test = async (quiet = false) => {
    setBusy('test');
    try {
      const r = await call(adminAiProvidersApi.test, { body: { provider: p.provider } });
      if (r.ok) {
        onModels(r.models);
        if (!quiet) toast(`Chave da ${NAME[p.provider]} funcionando: ${r.models.length} modelos disponíveis.`);
      } else toast(r.error ?? 'A chave não funcionou.', 'err');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      const r = await call(adminAiProvidersApi.put, { body: { [p.provider]: key.trim() } });
      onSaved(r.providers);
      setKey('');
      toast(`Chave da ${NAME[p.provider]} salva.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
      setBusy('');
      return;
    }
    await test(true);
  };
  const remove = () =>
    void confirmAction({
      title: `Remover a chave da ${NAME[p.provider]}?`,
      body: 'Os modelos deste provedor deixam de responder; a conversa passa para o modelo reserva e, sem ele, para o modo demo.',
      confirm: 'Remover chave',
      danger: true,
      run: () => call(adminAiProvidersApi.put, { body: { [p.provider]: null } }).then((r) => onSaved(r.providers)),
    }).then((ok) => ok && toast('Chave removida.'));
  return (
    <div class="stack" style={{ '--gap': '8px' }}>
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        <strong>{NAME[p.provider]}</strong>
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
        <Field id={id} label={p.keySet ? 'Trocar a chave da API' : 'Chave da API'} hint={KEY_HINT[p.provider]}>
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
            <Button label="Remover" icon="trash" kind="ghost" onClick={remove} />
          ) : null}
        </div>
      </form>
    </div>
  );
}

type Role = 'tutor' | 'tutorFallback' | 'asr' | 'tts';
const ROLES: readonly (readonly [Role, string, string, string])[] = [
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
  role: Role;
  k: string;
  label: string;
  hint: string;
  s?: AppSetting;
  keys: Record<AiProviderName, boolean>;
  /** The models each tested key can use: a listed model the key cannot use is left out. */
  available: Partial<Record<AiProviderName, string[]>>;
  onSaved: (s: AppSetting) => void;
}) {
  const saved = s?.value?.trim() || DEFAULT_MODELS[role];
  const [v, setV] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(saved), [saved]);
  const usable = (id: string) => {
    const p = id === TTS_ELEVEN ? 'workers' : aiProviderOf(id);
    if (p === 'workers') return true;
    const list = available[p];
    return !list || list.includes(id.slice(p.length + 1));
  };
  const options: [string, string][] = [...CATALOG[role]]
    .filter((c) => c.id === saved || usable(c.id))
    .sort((a, b) => TAG_ORDER[a.tag ?? 'none'] - TAG_ORDER[b.tag ?? 'none'])
    .map((c) => [c.id, `${c.tag ? TAG_TEXT[c.tag] : ''}${c.label}`]);
  if (!options.some(([id]) => id === saved)) options.push([saved, `${saved} · atual`]);
  const provider = v === TTS_ELEVEN ? 'workers' : aiProviderOf(v);
  const missing = provider !== 'workers' && !keys[provider];
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
        hint={missing ? `Salve a chave da ${NAME[provider as AiProviderName]} antes.` : hint}
        err={missing ? `Sem chave da ${NAME[provider as AiProviderName]}.` : null}
      >
        <Sel id={id} value={v} onValue={setV} options={options} />
      </Field>
      <div class="row" style={{ '--gap': '8px', paddingBottom: '22px' }}>
        <Button label="Salvar" icon="check" kind="light" busy={busy} disabled={v === saved || missing} onClick={save} />
        <span class="xs ad-mono">{s ? `mudou ${fmtAgo(s.updatedAt)}` : 'padrão'}</span>
      </div>
    </div>
  );
}

/**
 * "Medir velocidade": one short Mic-like turn on every conversation model this account can use (one
 * after the other), sorted by how long the learner would wait.
 */
function SpeedCompare({
  keys,
  available,
}: {
  keys: Record<AiProviderName, boolean>;
  available: Partial<Record<AiProviderName, string[]>>;
}) {
  const [rows, setRows] = useState<AiSpeedRes[]>([]);
  const [busy, setBusy] = useState(false);
  const candidates = CHAT.filter((c) => {
    const p = aiProviderOf(c.id);
    if (p === 'workers') return true;
    if (!keys[p]) return false;
    const list = available[p];
    return !list || list.includes(c.id.slice(p.length + 1));
  });
  const run = async () => {
    setBusy(true);
    setRows([]);
    try {
      for (const c of candidates) {
        let r: AiSpeedRes;
        try {
          r = await call(adminAiProvidersApi.speed, { body: { model: c.id } });
        } catch (e) {
          r = { model: c.id, ok: false, ms: 0, error: errorMessage(e) };
        }
        setRows((x) => [...x, r]);
      }
    } finally {
      setBusy(false);
    }
  };
  const label = (id: string) => CHAT.find((c) => c.id === id)?.label.split(' (')[0] ?? id;
  const sorted = [...rows].sort((a, b) => (a.ok === b.ok ? a.ms - b.ms : a.ok ? -1 : 1));
  const fastest = sorted.find((r) => r.ok)?.model;
  return (
    <div class="stack" style={{ '--gap': '8px' }}>
      <div class="row wrapx" style={{ '--gap': '8px' }}>
        <Button
          label={busy ? `Medindo… (${rows.length}/${candidates.length})` : 'Medir velocidade dos modelos'}
          icon="refresh"
          kind="light"
          busy={busy}
          disabled={busy}
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
                {label(r.model)}
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

/** The provider keys and the model pickers (Configurações → App). */
export function AiProviders({
  settings,
  onSetting,
}: {
  settings: readonly AppSetting[];
  onSetting: (s: AppSetting) => void;
}) {
  const load = useLoad((signal) => call(adminAiProvidersApi.get, { signal }), []);
  const [models, setModels] = useState<Partial<Record<AiProviderName, string[]>>>({});
  // With a key saved, its model list hides the listed models that key cannot use.
  useEffect(() => {
    for (const p of load.data?.providers ?? []) {
      if (!p.keySet || models[p.provider]) continue;
      call(adminAiProvidersApi.test, { body: { provider: p.provider } })
        .then((r) => r.ok && setModels((m) => ({ ...m, [p.provider]: r.models })))
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
          const keys = {
            anthropic: !!d.providers.find((p) => p.provider === 'anthropic')?.keySet,
            openai: !!d.providers.find((p) => p.provider === 'openai')?.keySet,
          };
          return (
            <div class="stack" style={{ '--gap': '18px' }}>
              {d.providers.map((p) => (
                <ProviderRow
                  key={p.provider}
                  p={p}
                  models={models[p.provider] ?? null}
                  onSaved={(providers) => load.setData(() => ({ providers }))}
                  onModels={(list) => setModels((m) => ({ ...m, [p.provider]: list }))}
                />
              ))}
              <div class="ad-note bl">
                Cada lista só traz modelos que fazem aquela tarefa. ⭐ marca o de melhor qualidade e 💰 o de melhor
                qualidade pelo preço. Na reserva, prefira outro provedor que o principal (o Llama 3.3 70B é grátis e não
                depende de chave): se o principal falhar ou ficar sem créditos, o aluno segue conversando.
              </div>
              {ROLES.map(([role, k, label, hint]) => (
                <ModelRow
                  key={role}
                  role={role}
                  k={k}
                  label={label}
                  hint={hint}
                  s={settings.find((x) => x.key === k)}
                  keys={keys}
                  available={models}
                  onSaved={onSetting}
                />
              ))}
              <SpeedCompare keys={keys} available={models} />
            </div>
          );
        }}
      </Async>
    </Card>
  );
}
