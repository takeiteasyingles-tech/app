// Configurações → App → Provedores de IA. PROD (spec 05 "Paid AI providers"): the Claude (Anthropic)
// and OpenAI API keys (sealed on the server, write-only) and the models the app runs: the conversation,
// its fallback and the transcription may run on Workers AI, Claude or OpenAI. The voice (TTS) and the
// safety check (Llama Guard) stay on Workers AI.
import { aiProviderOf, CLAUDE_MODELS, DEFAULT_MODELS, SETTINGS } from '@tie/shared/constants';
import { type AppSetting, adminOpsApi } from '@tie/shared/contracts/admin';
import { type AiProviderKey, type AiProviderName, adminAiProvidersApi } from '@tie/shared/contracts/aiProviders';
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
const CLAUDE_LABEL: Record<(typeof CLAUDE_MODELS)[number], string> = {
  'claude-opus-5-5': 'Claude Opus 5.5 · recomendado, o mais capaz',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 · mais rápido e mais barato',
  'claude-haiku-5-5': 'Claude Haiku 5.5 · o mais rápido e o mais barato',
};
/** OpenAI chat models in a key's list (not audio, images, embeddings…). */
const isOpenAiChat = (id: string) =>
  /^(gpt-|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct)/.test(id);
const isOpenAiAsr = (id: string) => /(transcribe|whisper)/.test(id);

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

type Role = 'tutor' | 'tutorFallback' | 'asr';
const ROLES: readonly (readonly [Role, string, string, string])[] = [
  [
    'tutor',
    SETTINGS.modelTutor,
    'Modelo da conversa',
    'Conversa do Mic, correções, relatório e rascunho das avaliações da temporada.',
  ],
  ['tutorFallback', SETTINGS.modelTutorFallback, 'Modelo reserva da conversa', 'Usado quando o principal falha.'],
  ['asr', SETTINGS.modelAsr, 'Modelo de transcrição', 'Ouve o aluno no Mic. O Claude não transcreve áudio.'],
];

function ModelRow({
  role,
  k,
  label,
  hint,
  s,
  keys,
  openai,
  onSaved,
}: {
  role: Role;
  k: string;
  label: string;
  hint: string;
  s?: AppSetting;
  keys: Record<AiProviderName, boolean>;
  openai: string[] | null;
  onSaved: (s: AppSetting) => void;
}) {
  const saved = s?.value?.trim() || DEFAULT_MODELS[role];
  const [v, setV] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(saved), [saved]);
  const options: [string, string][] = [];
  const add = (id: string, text: string) => {
    if (!options.some(([x]) => x === id)) options.push([id, text]);
  };
  if (role === 'asr') {
    add(DEFAULT_MODELS.asr, 'Whisper large v3 turbo · Workers AI (grátis, padrão)');
    for (const m of (openai ?? []).filter(isOpenAiAsr)) add(`openai:${m}`, `${m} · OpenAI`);
    add('openai:whisper-1', 'whisper-1 · OpenAI');
  } else {
    for (const m of CLAUDE_MODELS) add(`anthropic:${m}`, `${CLAUDE_LABEL[m]} · Anthropic`);
    for (const m of (openai ?? []).filter(isOpenAiChat)) add(`openai:${m}`, `${m} · OpenAI`);
    add(DEFAULT_MODELS.tutor, 'Llama 3.3 70B · Workers AI (grátis, padrão)');
    add(DEFAULT_MODELS.tutorFallback, 'Llama 3.1 8B · Workers AI (grátis, reserva padrão)');
  }
  add(saved, `${saved} · atual`);
  const provider = aiProviderOf(v);
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
  // The OpenAI list fills its pickers (its model names change often); Claude's are fixed.
  useEffect(() => {
    if (!load.data?.providers.find((p) => p.provider === 'openai')?.keySet || models.openai) return;
    call(adminAiProvidersApi.test, { body: { provider: 'openai' } })
      .then((r) => r.ok && setModels((m) => ({ ...m, openai: r.models })))
      .catch(() => undefined);
  }, [load.data]);
  return (
    <Card
      title="Provedores de IA"
      sub="O app usa o Workers AI da Cloudflare (grátis) por padrão. Com a chave da Anthropic ou da OpenAI, a conversa e a transcrição podem rodar nos modelos pagos delas. Voz e checagem de segurança continuam no Workers AI."
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
                Recomendado: <strong>Claude Opus 5.5</strong> na conversa, com o Llama 3.3 70B (Workers AI) de reserva:
                se a Anthropic falhar ou ficar sem créditos, o aluno segue conversando. A transcrição do Whisper no
                Workers AI já é boa; a da OpenAI é opcional.
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
                  openai={models.openai ?? null}
                  onSaved={onSetting}
                />
              ))}
            </div>
          );
        }}
      </Async>
    </Card>
  );
}
