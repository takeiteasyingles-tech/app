// Avatar do assistente do Mic em vídeo (port de prototipo/js/ui/avatar2d.js, TIE.avatar.mount):
// "idle" quando não está falando e, enquanto a voz sai, um de três clipes falando escolhido pelo
// humor da resposta: talk, talk-happy (elogio) ou talk-soft (correção, pensando). Sem clipes, as
// iniciais. Os <video> são JSX; só a classe .on e o play/pause são trocados por fora (Preact não
// mexe na classe porque ela não é prop), então um re-render nunca reinicia o clipe.
import type { AssistantPublic, ClipState } from '@tie/shared/content/schema';
import { assistInitials } from '@tie/ui';
import { useEffect, useRef } from 'preact/hooks';

/** encouraging → talk-happy, thinking/correcting → talk-soft; o resto → talk. */
const TALK: Readonly<Record<string, ClipState>> = {
  encouraging: 'talk-happy',
  thinking: 'talk-soft',
  correcting: 'talk-soft',
};
/** Se faltar o clipe pedido, usa outro clipe falando; só sem nenhum fica no idle. */
const ORDER: Readonly<Record<ClipState, readonly ClipState[]>> = {
  talk: ['talk', 'talk-soft', 'talk-happy'],
  'talk-happy': ['talk-happy', 'talk', 'talk-soft'],
  'talk-soft': ['talk-soft', 'talk', 'talk-happy'],
  idle: [],
};
const CLIPS: readonly ClipState[] = ['idle', 'talk', 'talk-happy', 'talk-soft'];

export type AvatarAssistant = Pick<AssistantPublic, 'k' | 'name' | 'full' | 'clips' | 'poster'>;

/** Clipe que deve aparecer para o estado (pickClip do protótipo). */
export function clipFor(available: readonly string[], talking: boolean, mood: string): string {
  const want: ClipState = talking ? (TALK[mood] ?? 'talk') : 'idle';
  return ORDER[want].find((x) => available.includes(x)) ?? 'idle';
}

export function AvatarVideo({ a, talking, mood }: { a: AvatarAssistant; talking: boolean; mood: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const clips = CLIPS.flatMap((k) => {
    const src = a.clips[k];
    return src ? [[k, src] as const] : [];
  });
  const keys = clips.map(([k]) => k);
  const cur = useRef('');

  useEffect(() => {
    const el = wrap.current;
    if (!el || !keys.length) return;
    const pick = clipFor(keys, talking, mood);
    if (cur.current === pick) return;
    cur.current = pick;
    for (const v of el.querySelectorAll('video')) {
      const on = v.getAttribute('data-k') === pick;
      v.classList.toggle('on', on);
      // O clipe que entra começa do início; o que sai pausa depois do cross-fade.
      if (on) {
        try {
          v.currentTime = 0;
        } catch {
          // Ainda sem metadados.
        }
        v.play()?.catch(() => {});
      } else {
        setTimeout(() => {
          if (!v.classList.contains('on')) v.pause();
        }, 300);
      }
    }
  });

  // destroy(): solta os vídeos ao trocar de assistente ou sair da tela.
  useEffect(() => {
    const el = wrap.current;
    return () => {
      if (!el) return;
      for (const v of el.querySelectorAll('video')) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    };
  }, []);

  if (!clips.length) {
    return (
      <div class="av2d vid">
        <div class="av-empty">
          <span class="av-ini" style={{ '--s': '120px' }}>
            {assistInitials(a)}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div class="av2d vid" ref={wrap}>
      {clips.map(([k, src]) => (
        <video
          key={k}
          data-k={k}
          src={src}
          muted
          loop
          playsInline
          preload="auto"
          poster={k === 'idle' ? (a.poster ?? undefined) : undefined}
        />
      ))}
    </div>
  );
}
