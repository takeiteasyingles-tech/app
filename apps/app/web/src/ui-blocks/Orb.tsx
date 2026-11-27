// The course's orb (first drawn for step 1, "Apresentação do Episódio"; also the Mic stage of an assistant
// whose avatar is an ElevenLabs agent, screens/maggie/AvatarOrb.tsx): CSS and SVG only, halos, a glowing
// sphere with a travelling wave and sound bars at its sides. `on` (audio playing, assistant talking) makes
// it pulse. Its size is --s on .pr-orb (orb.css); a caller sets it for its own room.
import './orb.css';

/** The orb: halos, sphere, wave and side bars; `on` while the audio plays. */
export function Orb({ on }: { on: boolean }) {
  return (
    <div class={`pr-orb${on ? ' on' : ''}`} aria-hidden="true">
      <span class="pr-halo h1" />
      <span class="pr-halo h2" />
      <span class="pr-halo h3" />
      <span class="pr-bars l">
        {[0.4, 0.7, 1, 0.6, 0.35].map((h, i) => (
          <i key={i} style={{ '--h': String(h), '--d': `${i * 0.12}s` }} />
        ))}
      </span>
      <span class="pr-bars r">
        {[0.35, 0.6, 1, 0.7, 0.4].map((h, i) => (
          <i key={i} style={{ '--h': String(h), '--d': `${i * 0.12 + 0.3}s` }} />
        ))}
      </span>
      <span class="pr-sphere">
        <span class="pr-swirl" />
        <span class="pr-shine" />
        <svg class="pr-wave" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
          <g class="pr-wave-a">
            <path d="M0 50 Q 25 15 50 50 T 100 50 T 150 50 T 200 50 T 250 50 T 300 50 T 350 50 T 400 50" />
          </g>
          <g class="pr-wave-b">
            <path d="M0 50 Q 25 80 50 50 T 100 50 T 150 50 T 200 50 T 250 50 T 300 50 T 350 50 T 400 50" />
          </g>
        </svg>
      </span>
      <span class="pr-floor" />
    </div>
  );
}
