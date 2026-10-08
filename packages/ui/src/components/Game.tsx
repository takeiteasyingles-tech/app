import { Icon } from '../icons';

/** The parts of game.summary() (GameSummary) these components read. */
export type GameView = {
  points: number;
  streak: number;
  level: { n: number; name: string };
  goal: { done: number; target: number; pct: number };
};

/** C.gamebar: streak / points / today's goal tiles. */
export function Gamebar({ g }: { g: GameView }) {
  return (
    <div class="gamebar">
      <a class="g streak" href="#/conquistas">
        <span class="ic">
          <Icon name="fire" size={16} />
        </span>
        <span>
          <b>{g.streak}</b>
          <small>sequência</small>
        </span>
      </a>
      <a class="g pts" href="#/conquistas">
        <span class="ic">
          <Icon name="coin" size={16} />
        </span>
        <span>
          <b>{g.points}</b>
          <small>pontos</small>
        </span>
      </a>
      <a class="g goal" href="#/inicio">
        <span class="ic">
          <Icon name="target" size={16} />
        </span>
        <span>
          <b>{`${g.goal.done}/${g.goal.target}`}</b>
          <small>meta hoje</small>
        </span>
      </a>
    </div>
  );
}

/** C.levelpill */
export function LevelPill({ level }: { level: GameView['level'] }) {
  return (
    <span class="levelpill">
      <i>{level.n}</i>
      {level.name}
    </span>
  );
}

export type MissionView = { k?: string; t: string; go: string; done: boolean };

/** C.missions: today's missions, each worth +15. */
export function Missions({ list }: { list: readonly MissionView[] }) {
  return (
    <div>
      {list.map((m) => (
        <a key={m.k ?? m.t} class={`mission${m.done ? ' done' : ''}`} href={`#/${m.go}`}>
          <span class="ck">{m.done ? <Icon name="check" size={16} /> : null}</span>
          <span class="grow">
            <span class="h3" style={{ display: 'block', fontSize: '1rem' }}>
              {m.t}
            </span>
          </span>
          <span class="pill gold">+15</span>
        </a>
      ))}
    </div>
  );
}
