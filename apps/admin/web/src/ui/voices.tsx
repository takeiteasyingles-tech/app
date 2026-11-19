// ElevenLabs voice picker shared by Configurações → Vozes and the episode editor (lesson voices):
// a select of the account's voices (loaded once per session), "Ouvir" (the chosen voice reading a
// short line) and "Biblioteca…" (search the ElevenLabs Voice Library, listen to a sample, add a voice
// to the account and pick it). PROD (spec 05 "Lesson voices").
import { signal } from '@preact/signals';
import type { ElevenVoice, LibraryVoice } from '@tie/shared/contracts/voices';
import { adminVoicesApi } from '@tie/shared/contracts/voices';
import { ApiError, isErrorEnvelope } from '@tie/shared/errors';
import { useEffect, useRef, useState } from 'preact/hooks';
import { call, errorMessage, NetworkError, urlFor } from '../api';
import { Button, Sel, TextIn } from './kit';
import { Modal } from './modal';
import { toast } from './toast';

const CATEGORY: Record<string, string> = {
  cloned: 'clonada',
  professional: 'biblioteca',
  generated: 'gerada',
  premade: 'padrão ElevenLabs',
  famous: 'biblioteca',
  high_quality: 'biblioteca',
};

/** "Rachel · feminina · american · padrão ElevenLabs". */
export function voiceLabel(v: ElevenVoice): string {
  const gender = v.gender === 'female' ? 'feminina' : v.gender === 'male' ? 'masculina' : null;
  return [v.name, gender, v.accent, CATEGORY[v.category] ?? v.category].filter(Boolean).join(' · ');
}

/** The ElevenLabs account's voices (null until loaded). */
export const accountVoices = signal<ElevenVoice[] | null>(null);
const accountError = signal<string | null>(null);
let pending: Promise<void> | null = null;

export function loadAccountVoices(force = false): Promise<void> {
  if (pending && !force) return pending;
  if (accountVoices.value && !force) return Promise.resolve();
  pending = call(adminVoicesApi.account)
    .then((r) => {
      accountVoices.value = r.voices;
      accountError.value = null;
    })
    .catch((e) => {
      accountError.value = errorMessage(e);
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

function addAccountVoice(v: ElevenVoice): void {
  const list = accountVoices.value ?? [];
  if (!list.some((x) => x.id === v.id)) accountVoices.value = [...list, v].sort((a, b) => a.name.localeCompare(b.name));
}

let player: HTMLAudioElement | null = null;
let playerUrl: string | null = null;

async function fetchAudio(url: string, init: RequestInit): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: 'same-origin' });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    throw isErrorEnvelope(data)
      ? new ApiError(data.error.code, data.error.message, data.error.details)
      : new ApiError('internal');
  }
  return res.blob();
}

function play(blob: Blob): void {
  player?.pause();
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = URL.createObjectURL(blob);
  player = new Audio(playerUrl);
  player.play().catch(() => toast('O navegador bloqueou o áudio. Toque de novo.', 'err'));
}

/** Plays any account voice reading `text` (or the server's default line). */
export async function previewVoice(voiceId: string, text?: string): Promise<void> {
  play(
    await fetchAudio(urlFor(adminVoicesApi.preview), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(text ? { voiceId, text } : { voiceId }),
    }),
  );
}

async function playSample(url: string): Promise<void> {
  play(await fetchAudio(urlFor(adminVoicesApi.librarySample, { query: { url } }), { method: 'GET' }));
}

export function VoicePicker({
  id,
  value,
  onValue,
  emptyLabel,
  previewText,
}: {
  id: string;
  value: string | null;
  onValue: (v: string | null) => void;
  /** Label of the "no voice" option. */
  emptyLabel: string;
  /** Line read by "Ouvir" (defaults to the server's). */
  previewText?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [library, setLibrary] = useState(false);
  useEffect(() => void loadAccountVoices(), []);
  const voices = accountVoices.value;
  const known = !value || !!voices?.some((v) => v.id === value);
  const options: (readonly [string, string])[] = [
    ['', emptyLabel],
    ...(known || !value ? [] : [[value, `ID ${value} (fora da conta)`] as const]),
    ...(voices ?? []).map((v) => [v.id, voiceLabel(v)] as const),
  ];
  const listen = async () => {
    if (!value) return;
    setPlaying(true);
    try {
      await previewVoice(value, previewText);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setPlaying(false);
    }
  };
  return (
    <div class="row wrapx" style={{ '--gap': '8px', alignItems: 'center' }}>
      <div class="grow" style={{ minWidth: '220px' }}>
        <Sel id={id} value={value ?? ''} onValue={(v) => onValue(v || null)} options={options} />
      </div>
      <Button
        label="Ouvir"
        icon="play"
        kind="light"
        busy={playing}
        disabled={!value || playing}
        title={value ? 'Ouvir esta voz lendo uma frase da lição' : 'Escolha uma voz'}
        onClick={() => void listen()}
      />
      <Button label="Biblioteca…" icon="search" kind="light" onClick={() => setLibrary(true)} />
      {voices === null && accountError.value ? (
        <span class="xs" role="alert">
          {accountError.value}
        </span>
      ) : null}
      {library ? (
        <LibraryModal
          onClose={() => setLibrary(false)}
          onAdded={(v) => {
            addAccountVoice(v);
            onValue(v.id);
            setLibrary(false);
          }}
        />
      ) : null}
    </div>
  );
}

function LibraryModal({ onClose, onAdded }: { onClose: () => void; onAdded: (v: ElevenVoice) => void }) {
  const [q, setQ] = useState('');
  const [gender, setGender] = useState('');
  const [items, setItems] = useState<LibraryVoice[] | null>(null);
  // '' | 'search' | `add:${id}` | `play:${id}`
  const [busy, setBusy] = useState('');
  const seq = useRef(0);
  const search = async () => {
    const n = ++seq.current;
    setBusy('search');
    try {
      const res = await call(adminVoicesApi.library, {
        query: {
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(gender ? { gender: gender as 'male' | 'female' } : {}),
        },
      });
      if (n === seq.current) setItems(res.voices);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      if (n === seq.current) setBusy('');
    }
  };
  useEffect(() => void search(), []);
  const add = async (v: LibraryVoice) => {
    setBusy(`add:${v.id}`);
    try {
      const res = await call(adminVoicesApi.libraryAdd, { body: { ownerId: v.ownerId, voiceId: v.id, name: v.name } });
      toast(`${v.name} foi adicionada à conta da ElevenLabs.`);
      onAdded(res.voice);
    } catch (e) {
      toast(errorMessage(e), 'err');
      setBusy('');
    }
  };
  const listen = async (v: LibraryVoice) => {
    if (!v.sampleUrl) return;
    setBusy(`play:${v.id}`);
    try {
      await playSample(v.sampleUrl);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal title="Biblioteca de vozes da ElevenLabs" onClose={onClose} size="lg" locked={busy.startsWith('add:')}>
      <div class="stack" style={{ '--gap': '12px' }}>
        <form
          class="row wrapx"
          style={{ '--gap': '8px', alignItems: 'center' }}
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div class="grow" style={{ minWidth: '200px' }}>
            <TextIn
              id="lib-q"
              value={q}
              onValue={setQ}
              placeholder="Buscar: warm, narrator, teen, british…"
              aria-label="Buscar na biblioteca"
              maxLength={80}
            />
          </div>
          <Sel
            id="lib-g"
            ariaLabel="Gênero da voz"
            value={gender}
            onValue={setGender}
            options={[
              ['', 'Todas'],
              ['female', 'Femininas'],
              ['male', 'Masculinas'],
            ]}
          />
          <Button label="Buscar" icon="search" type="submit" busy={busy === 'search'} />
        </form>
        <p class="xs">
          Vozes em inglês compartilhadas na ElevenLabs. Adicionar coloca a voz na sua conta (usa um espaço de voz do
          plano) e já escolhe ela aqui.
        </p>
        {items === null ? null : items.length === 0 ? (
          <p class="sm">Nenhuma voz encontrada.</p>
        ) : (
          <ul class="stack" style={{ '--gap': '0', listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((v) => (
              <li
                key={`${v.ownerId}/${v.id}`}
                class="row wrapx between"
                style={{ '--gap': '8px', padding: '10px 0', borderTop: '1.5px solid var(--line)' }}
              >
                <div class="grow" style={{ minWidth: '200px' }}>
                  <b>{voiceLabel(v)}</b>
                  {v.description ? <div class="xs">{v.description}</div> : null}
                </div>
                <div class="row" style={{ '--gap': '8px' }}>
                  <Button
                    label="Ouvir"
                    icon="play"
                    kind="light"
                    busy={busy === `play:${v.id}`}
                    disabled={!v.sampleUrl || !!busy}
                    onClick={() => void listen(v)}
                  />
                  <Button
                    label="Adicionar e usar"
                    icon="plus"
                    busy={busy === `add:${v.id}`}
                    disabled={!!busy}
                    onClick={() => void add(v)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
