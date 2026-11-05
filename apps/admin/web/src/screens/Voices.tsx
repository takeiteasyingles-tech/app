// Configurações → Vozes: the ElevenLabs API key (write-only: only its last 4 characters come back), the
// model and the cloned voice of each assistant, used by the student app's HD voice (/api/tts). A voice
// can be cloned here from an audio sample (Instant Voice Clone) and tested before learners hear it.
import { ELEVEN_MODELS, type ElevenModel } from '@tie/shared/constants';
import { adminVoicesApi, type VoiceSettings, type VoiceSettingsBody } from '@tie/shared/contracts/voices';
import { ApiError, isErrorEnvelope } from '@tie/shared/errors';
import { useEffect, useRef, useState } from 'preact/hooks';
import { call, errorMessage, NetworkError, urlFor } from '../api';
import { fmtAgo } from '../format';
import { useLoad } from '../ui/async';
import { Icon } from '../ui/icons';
import { Async, Button, Card, Field, Pill, Sel, TextIn } from '../ui/kit';
import { confirmAction } from '../ui/modal';
import { toast } from '../ui/toast';

const MODEL_LABEL: Record<ElevenModel, string> = {
  eleven_turbo_v2_5: 'Turbo v2.5 (rápido, recomendado)',
  eleven_flash_v2_5: 'Flash v2.5 (o mais rápido)',
  eleven_multilingual_v2: 'Multilingual v2 (mais natural, mais lento)',
};

/** Binary or multipart calls: same-origin cookies, the server's error envelope as an ApiError. */
async function raw(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: 'same-origin' });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (res.ok) return res;
  const data = await res.json().catch(() => null);
  throw isErrorEnvelope(data)
    ? new ApiError(data.error.code, data.error.message, data.error.details)
    : new ApiError('internal');
}

function KeyCard({ s, onSaved }: { s: VoiceSettings; onSaved: (s: VoiceSettings) => void }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState<ElevenModel>(s.model);
  const [busy, setBusy] = useState(false);
  useEffect(() => setModel(s.model), [s.model]);
  const save = async (body: VoiceSettingsBody) => {
    setBusy(true);
    try {
      const res = await call(adminVoicesApi.put, { body });
      onSaved(res.settings);
      setKey('');
      toast('Configuração de voz salva.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  const remove = () =>
    void confirmAction({
      title: 'Remover a chave da ElevenLabs?',
      body: 'As assistentes voltam para a voz padrão (Workers AI) até uma nova chave ser salva.',
      confirm: 'Remover chave',
      danger: true,
      run: () => call(adminVoicesApi.put, { body: { apiKey: null } }).then((r) => onSaved(r.settings)),
    }).then((ok) => ok && toast('Chave removida.'));
  return (
    <Card
      title="ElevenLabs"
      sub="Com a chave e uma voz clonada, a assistente fala com a própria voz na voz HD do Mic. Sem elas, usa a voz padrão."
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
              options={ELEVEN_MODELS.map((m) => [m, MODEL_LABEL[m]] as const)}
            />
          </Field>
        </div>
        <div class="row wrapx" style={{ '--gap': '8px' }}>
          <Button
            label="Salvar"
            icon="check"
            busy={busy}
            disabled={(!key.trim() || key.trim().length < 20) && model === s.model}
            onClick={() =>
              void save({ ...(key.trim() ? { apiKey: key.trim() } : {}), ...(model !== s.model ? { model } : {}) })
            }
          />
          {s.keySet && s.keySource === 'settings' ? (
            <Button label="Remover chave" icon="trash" kind="ghost" onClick={remove} />
          ) : null}
          {key.trim() && key.trim().length < 20 ? <span class="xs">A chave parece curta demais.</span> : null}
        </div>
      </div>
    </Card>
  );
}

function AssistantRow({
  a,
  s,
  onSaved,
}: {
  a: { key: string; name: string };
  s: VoiceSettings;
  onSaved: (s: VoiceSettings) => void;
}) {
  const current = s.voices[a.key] ?? '';
  const [voice, setVoice] = useState(current);
  const [busy, setBusy] = useState<'' | 'save' | 'clone' | 'test'>('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => setVoice(current), [current]);
  useEffect(() => () => void (audioUrl && URL.revokeObjectURL(audioUrl)), [audioUrl]);
  const id = `voice-${a.key}`;
  const saveId = async (value: string | null) => {
    setBusy('save');
    try {
      const r = await call(adminVoicesApi.put, { body: { voices: { [a.key]: value } } });
      onSaved(r.settings);
      toast(value ? `Voz de ${a.name} salva.` : `${a.name} volta para a voz padrão.`);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy('');
    }
  };
  const clone = async (file: File) => {
    setBusy('clone');
    try {
      const fd = new FormData();
      fd.append('assistantKey', a.key);
      fd.append('file', file, file.name);
      const res = await raw(urlFor(adminVoicesApi.clone), { method: 'POST', body: fd });
      const data = (await res.json()) as { voiceId: string; settings: VoiceSettings };
      onSaved(data.settings);
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
      const res = await raw(urlFor(adminVoicesApi.test), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantKey: a.key }),
      });
      const url = URL.createObjectURL(await res.blob());
      setAudioUrl(url);
      queueMicrotask(() => void audioRef.current?.play().catch(() => undefined));
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy('');
    }
  };
  const dirty = voice.trim() !== current;
  return (
    <li class="stack" style={{ '--gap': '8px', padding: '12px 0', borderTop: '1.5px solid var(--line)' }}>
      <div class="row wrapx between" style={{ '--gap': '8px' }}>
        <b>{a.name}</b>
        {current ? <Pill label="Voz clonada" tone="gr" icon="check" /> : <Pill label="Voz padrão" />}
      </div>
      <div class="row wrapx" style={{ '--gap': '8px', alignItems: 'flex-end' }}>
        <Field id={id} label="ID da voz na ElevenLabs" cls="grow">
          <TextIn
            id={id}
            value={voice}
            onValue={setVoice}
            spellcheck={false}
            maxLength={40}
            placeholder="ex.: 21m00Tcm4TlvDq8ikWAM"
          />
        </Field>
        <Button
          label="Salvar ID"
          kind="light"
          busy={busy === 'save'}
          disabled={!dirty || !!busy}
          onClick={() => void saveId(voice.trim() || null)}
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
          disabled={!s.keySet || !current || !!busy}
          onClick={() => void test()}
        />
        {current ? (
          <Button
            ariaLabel={`Voltar ${a.name} para a voz padrão`}
            title="Usar a voz padrão"
            icon="trash"
            kind="ghost"
            onClick={() => void saveId(null)}
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
          {/* biome-ignore lint/a11y/useMediaCaption: voice test; its text is shown right below. */}
          <audio ref={audioRef} src={audioUrl} controls preload="auto" style={{ width: '100%' }} />
          <span class="xs">"Hi! I'm {a.name}. Let's practice a little English together today."</span>
        </div>
      ) : null}
    </li>
  );
}

export function VoicesSettings() {
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
            <KeyCard s={s} onSaved={setS} />
            <Card
              title="Vozes das assistentes"
              sub="Cole o ID de uma voz que já existe na sua conta ElevenLabs, ou clone a partir de uma amostra (1 a 3 minutos de fala limpa, MP3 ou WAV até 10 MB). A voz nova vale para as próximas falas do Mic."
            >
              <ul class="stack" style={{ '--gap': '0', listStyle: 'none', margin: 0, padding: 0 }}>
                {s.assistants.map((a) => (
                  <AssistantRow key={a.key} a={a} s={s} onSaved={setS} />
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
