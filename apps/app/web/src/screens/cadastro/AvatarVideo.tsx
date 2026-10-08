// TIE.avatar.mount (prototipo/js/ui/avatar2d.js) as a component: one muted, looping <video> per
// clip, the idle one with its poster; while talking, the clip for the mood (cross-fade in tie.css).
// Without clips, the initials. The 'on' class is managed here (Preact never sets class on the videos).
import type { AssistantPublic, ClipState } from '@tie/shared/content/schema';
import { assistInitials } from '@tie/ui';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

const CLIPS: readonly ClipState[] = ['idle', 'talk', 'talk-happy', 'talk-soft'];
const TALK: Readonly<Record<string, ClipState>> = {
  encouraging: 'talk-happy',
  thinking: 'talk-soft',
  correcting: 'talk-soft',
};
const ORDER: Readonly<Record<ClipState, readonly ClipState[]>> = {
  talk: ['talk', 'talk-soft', 'talk-happy'],
  'talk-happy': ['talk-happy', 'talk', 'talk-soft'],
  'talk-soft': ['talk-soft', 'talk', 'talk-happy'],
  idle: [],
};

export function AvatarVideo({
  a,
  talking = false,
  mood = 'happy',
  style,
}: {
  a: AssistantPublic | undefined;
  talking?: boolean;
  mood?: string;
  /** Overrides the `.av2d` box (e.g. held to the picture area above a subtitle bar). */
  style?: JSX.CSSProperties | undefined;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const clips = a ? CLIPS.filter((k) => !!a.clips[k]) : [];
  const want: ClipState = talking ? (ORDER[TALK[mood] ?? 'talk'].find((x) => clips.includes(x)) ?? 'idle') : 'idle';

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    for (const v of el.querySelectorAll('video')) {
      const on = v.getAttribute('data-k') === want;
      if (on === v.classList.contains('on')) continue;
      v.classList.toggle('on', on);
      if (on) {
        try {
          v.currentTime = 0;
        } catch {
          // Not loaded yet.
        }
        v.play()?.catch(() => {});
      } else {
        setTimeout(() => {
          if (!v.classList.contains('on')) v.pause();
        }, 300);
      }
    }
  }, [want, clips.length]);

  useEffect(
    () => () => {
      for (const v of wrap.current?.querySelectorAll('video') ?? []) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
    [],
  );

  if (!a) return null;
  return (
    <div class="av2d vid" ref={wrap} style={style}>
      {clips.length ? (
        clips.map((k) => (
          <video
            key={k}
            data-k={k}
            src={a.clips[k]}
            muted
            loop
            playsInline
            preload="auto"
            poster={k === 'idle' ? (a.poster ?? undefined) : undefined}
          />
        ))
      ) : (
        <div class="av-empty">
          <span class="av-ini" style={{ '--s': '120px' }}>
            {assistInitials(a)}
          </span>
        </div>
      )}
    </div>
  );
}
