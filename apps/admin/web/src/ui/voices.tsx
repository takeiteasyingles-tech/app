// ElevenLabs voice pickers (spec 05 "Lesson voices"): the account's voices (cloned, premade and the ones
// added from the Voice Library) in a select, a preview of any of them, and a Voice Library search that
// adds a voice to the account. Used by the episode editor (Vozes desta lição) and Configurações → Vozes.
import { signal } from '@preact/signals';
import { adminVoicesApi, type ElevenVoice, type LibraryVoice } from '@tie/shared/contracts/voices';
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

/** "Rachel · feminina · American · biblioteca" */
export function voiceLabel(v: ElevenVoice): string {
  const g = v.gender === 'female' ? 'feminina' : v.gender === 'male' ? 'masculina' : null;
  return [v.name, g, v.accent, CATEGORY[v.category] ?? v.category].filter(Boolean).join(' · ');
}

// ---------- account voices (one load per page view) ----------

export const accountVoices = signal<ElevenVoice[] | null>(null);
export const accountError = signal<string | null>(null);
let inflight: Promise<void> | null = null;

export function loadAccountVoices(force = false): Promise<void> {
  if (inflight && !force) return inflight;
  if (accountVoices.value && !force) return Promise.resolve();
  inflight = call(adminVoicesApi.account)
    .then((r) => {
      accountVoices.value = r.voices;
      accountError.value = null;
    })
    .catch((e) => {
      accountError.value = errorMessage(e);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function addToAccount(v: ElevenVoice): void {
  const list = accountVoices.value ?? [];
  if (!list.some((x) => x.id === v.id)) {
    accountVoices.value = [...list, v].sort((a, b) => a.name.localeCompare(b.name));
  }
}

// ---------- playback ----------

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
    const data = await res.json().catch(() => null);
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
  void player.play().catch(() => toast('O navegador bloqueou o áudio. Toque de novo.', 'err'));
}

/** Plays an account voice reading a short lesson line. */
export async function previewVoice(voiceId: string, text?: string): Promise<void> {
  const blob = await fetchAudio(urlFor(adminVoicesApi.preview), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(text ? { voiceId, text } : { voiceId }),
  });
  play(blob);
}

async function playSample(url: string): Promise<void> {
  play(await fetchAudio(urlFor(adminVoicesApi.librarySample, { query: { url } }), { method: 'GET' }));
}

// ---------- the select ----------

/**
 * One voice: a select of the account's voices ('' = `emptyLabel`), "Ouvir" and "Biblioteca…". A saved id
 * that is not in the account any more still shows, so it can be seen and replaced.
 */
export function VoicePick({
  id,
  value,
  onValue,
  emptyLabel,
  previewText,
}: {
  id: string;
  value: string | null;
  onValue: (v: string | null) => void;
  emptyLabel: string;
  previewText?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [lib, setLib] = useState(false);
  useEffect(() => void loadAccountVoices(), []);
  const list = accountVoices.value;
  const known = !value || !!list?.some((v) => v.id === value);
  const options: [string, string][] = [
    ['', emptyLabel],
    ...(known || !value ? [] : [[value, `ID ${value} (fora da conta)`] as [string, string]]),
    ...(list ?? []).map((v) => [v.id, voiceLabel(v)] as [string, string]),
  ];
  const listen = async () => {
    if (!value) return;
    setBusy(true);
    try {
      await previewVoice(value, previewText);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
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
        busy={busy}
        disabled={!value || busy}
        title={value ? 'Ouvir esta voz lendo uma frase da lição' : 'Escolha uma voz'}
        onClick={() => void listen()}
      />
      <Button label="Biblioteca…" icon="search" kind="light" onClick={() => setLib(true)} />
      {list === null && accountError.value ? (
        <span class="xs" role="alert">
          {accountError.value}
        </span>
      ) : null}
      {lib ? (
        <LibraryModal
          onClose={() => setLib(false)}
          onAdded={(v) => {
            addToAccount(v);
            onValue(v.id);
            setLib(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------- Voice Library ----------

export function LibraryModal({ onClose, onAdded }: { onClose: () => void; onAdded: (v: ElevenVoice) => void }) {
  const [q, setQ] = useState('');
  const [gender, setGender] = useState<'' | 'male' | 'female'>('');
  const [items, setItems] = useState<LibraryVoice[] | null>(null);
  const [busy, setBusy] = useState<string>('');
  const seq = useRef(0);
  const search = async () => {
    const my = ++seq.current;
    setBusy('search');
    try {
      const r = await call(adminVoicesApi.library, {
        query: { ...(q.trim() ? { q: q.trim() } : {}), ...(gender ? { gender } : {}) },
      });
      if (my === seq.current) setItems(r.voices);
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      if (my === seq.current) setBusy('');
    }
  };
  useEffect(() => void search(), []);
  const add = async (v: LibraryVoice) => {
    setBusy(`add:${v.id}`);
    try {
      const r = await call(adminVoicesApi.libraryAdd, { body: { ownerId: v.ownerId, voiceId: v.id, name: v.name } });
      toast(`${v.name} foi adicionada à conta da ElevenLabs.`);
      onAdded(r.voice);
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
            onValue={(v) => setGender(v as '' | 'male' | 'female')}
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
