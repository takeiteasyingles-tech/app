import { Icon } from '../icons';
import { type GameView, LevelPill } from './Game';
import { Logo } from './Logo';

/** [route, label, icon] of the main sections. */
export const NAV = [
  ['inicio', 'Hoje', 'home'],
  ['trilha', 'Trilha', 'trail'],
  ['extra', 'EXTRA', 'tv'],
  ['maggie', 'Mic', 'mic'],
  ['perfil', 'Você', 'profile'],
] as const;

/** On the phone tab bar, Revisão takes the place of Você; the profile stays in the top avatar. */
export const TABS = [...NAV.slice(0, 4), ['revisao', 'Revisão', 'cards']] as const;

export type NavSection = (typeof NAV)[number][0] | 'revisao' | 'conquistas' | '';

/** C.tabbar: mobile bottom navigation with the Revisão due badge. */
export function Tabbar({ active, due }: { active: string; due: number }) {
  return (
    <nav class="tabbar" aria-label="Navegação">
      {TABS.map(([k, l, ic]) => (
        <a key={k} class={`tab${active === k ? ' on' : ''}`} href={`#/${k}`}>
          <span class="ico">
            <Icon name={ic} size={22} />
            {k === 'revisao' && due ? <b class="badge">{due}</b> : null}
          </span>
          <span>{l}</span>
        </a>
      ))}
    </nav>
  );
}

/** C.side: desktop sidebar with the goal / level / streak card. */
export function Side({ active, due, g }: { active: string; due: number; g: GameView }) {
  return (
    <aside class="side on-navy">
      <Logo size={19} white />
      {NAV.map(([k, l, ic]) => (
        <a key={k} class={`nav${active === k ? ' on' : ''}`} href={`#/${k}`}>
          <Icon name={ic} size={21} />
          <span>{l}</span>
        </a>
      ))}
      <a class={`nav${active === 'revisao' ? ' on' : ''}`} href="#/revisao">
        <Icon name="cards" size={21} />
        <span>Revisão</span>
        {due ? <span class="badge">{due}</span> : null}
      </a>
      <a class={`nav${active === 'conquistas' ? ' on' : ''}`} href="#/conquistas">
        <Icon name="trophy" size={21} />
        <span>Conquistas</span>
      </a>
      <div class="foot">
        <div class="card" style={{ background: 'var(--navy2)', borderColor: 'var(--navy2)', padding: '14px' }}>
          <div class="row between">
            <span class="lbl">Meta de hoje</span>
            <span class="sm" style={{ color: '#fff', fontWeight: 800 }}>
              {`${g.goal.done}/${g.goal.target}`}
            </span>
          </div>
          <div class="bar mt8">
            <i style={{ width: `${g.goal.pct}%` }} />
          </div>
          <div class="row mt12" style={{ '--gap': '8px' }}>
            <LevelPill level={g.level} />
            <span class="xs">{`${g.streak} dias seguidos`}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
