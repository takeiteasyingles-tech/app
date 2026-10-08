// Gamificação (admin): points per action and their daily caps, the level ladder and the medals with
// their rules. Saved as one document; it takes effect for new awards right away (no publish), and
// the student app shows the new catalog after the next content publish.
import { POINT_KINDS } from '@tie/shared/content/schema';
import { adminAiApi, type Gamification as G, GamificationBody } from '@tie/shared/contracts/admin';
import { ICON_NAMES } from '@tie/ui/icons';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage, issuesOf } from '../../api';
import { setQuery } from '../../router';
import { useLoad } from '../../ui/async';
import { ErrorSummary, Form, type Spec } from '../../ui/form';
import { Icon } from '../../ui/icons';
import { ErrorBox, Page, Skeleton, TabsNav } from '../../ui/kit';
import { toast } from '../../ui/toast';
import { type Errors, issuesToErrors, zodErrors } from '../../ui/validate';
import type { ScreenProps } from '../registry';
import { SaveBar, same, useLeaveGuard, useSaveShortcut } from './common';
import { tabFinder } from './DocEditor';

export const KIND_LABEL: Record<string, string> = {
  step: 'Etapa concluída',
  episode: 'Episódio concluído',
  ex_right: 'Acerto em exercício',
  mic_try: 'Frase gravada',
  mic_good: 'Frase boa (nota 8+)',
  song: 'Música cantada',
  maggie_turn: 'Fala no Mic',
  maggie_session: 'Conversa no Mic',
  extra: 'Extra assistido',
  dub: 'Dublagem',
  card: 'Cartão revisado',
  quiz_hit: 'Acerto em quiz',
  test_pass: 'Teste do e-book',
  mission: 'Missão do dia',
  word: 'Palavra nova',
};

const SPECS: Record<string, readonly Spec[]> = {
  pontos: [
    {
      t: 'list',
      k: 'pointRules',
      label: 'Pontos por ação',
      item: 'regra',
      inline: true,
      fixed: true,
      hint: 'Limite diário vazio = sem limite. "Verificável" = o servidor confirma a ação (não é só o app dizendo).',
      of: [
        {
          t: 'custom',
          k: 'kind',
          label: 'Ação',
          render: ({ value }) => (
            <span class="ad-cell2" style={{ paddingTop: '4px' }}>
              <b>{KIND_LABEL[String(value)] ?? String(value)}</b>
              <span class="xs ad-mono">{String(value)}</span>
            </span>
          ),
        },
        { t: 'int', k: 'points', label: 'Pontos', min: 0, max: 1000 },
        { t: 'int', k: 'dailyCap', label: 'Limite por dia', opt: 'null', min: 0 },
        { t: 'bool', k: 'verifiable', label: 'Verificável' },
      ],
    },
  ],
  niveis: [
    {
      t: 'list',
      k: 'levels',
      label: 'Níveis',
      item: 'nível',
      inline: true,
      hint: 'Em ordem: cada nível começa nos pontos indicados. O primeiro começa em 0.',
      of: [
        { t: 'int', k: 'n', label: 'Nível', min: 1 },
        { t: 'int', k: 'minPoints', label: 'A partir de (pontos)', min: 0 },
        { t: 'text', k: 'name', label: 'Nome' },
      ],
    },
  ],
  medalhas: [
    {
      t: 'list',
      k: 'badges',
      label: 'Medalhas',
      item: 'medalha',
      summary: (v) => String(v.title ?? ''),
      make: () => ({ id: '', title: '', sub: '', icon: 'star', rule: { type: 'points', min: 100 }, sort: 0 }),
      of: [
        { t: 'text', k: 'id', label: 'Identificador', mono: true, hint: 'Minúsculas, números e hífen.' },
        { t: 'text', k: 'title', label: 'Título' },
        { t: 'text', k: 'sub', label: 'Como ganhar (texto)' },
        { t: 'select', k: 'icon', label: 'Ícone', options: ICON_NAMES.map((n) => [n, n] as const) },
        { t: 'int', k: 'sort', label: 'Ordem' },
        {
          t: 'obj',
          k: 'rule',
          label: 'Regra',
          of: [
            {
              t: 'select',
              k: 'type',
              label: 'Tipo',
              options: [
                ['count', 'Quantidade de uma ação'],
                ['streak', 'Dias seguidos'],
                ['points', 'Pontos no total'],
                ['goal_days', 'Dias com a meta batida'],
              ],
            },
            {
              t: 'select',
              k: 'kind',
              label: 'Ação contada',
              options: POINT_KINDS.map((k) => [k, KIND_LABEL[k] ?? k] as const),
              when: (r) => r.type === 'count',
            },
            { t: 'int', k: 'min', label: 'Quantidade mínima', min: 1 },
          ],
        },
      ],
    },
  ],
};

const TABS = [
  ['pontos', 'Pontos'],
  ['niveis', 'Níveis'],
  ['medalhas', 'Medalhas'],
] as const;
const ALL = Object.values(SPECS).flat();
const tabOf = tabFinder(SPECS, 'pontos');

function clean(g: G): G {
  return {
    pointRules: g.pointRules,
    levels: g.levels,
    badges: g.badges.map((b) => ({
      ...b,
      rule:
        b.rule.type === 'count'
          ? { type: 'count', kind: b.rule.kind ?? 'step', min: b.rule.min }
          : { type: b.rule.type, min: b.rule.min },
    })) as G['badges'],
  };
}

export function Gamification({ q }: ScreenProps) {
  const tab = TABS.some(([t]) => t === q.aba) ? (q.aba as string) : 'pontos';
  const load = useLoad((signal) => call(adminAiApi.gamification, { signal }), []);
  const [base, setBase] = useState<G | null>(null);
  const [draft, setDraft] = useState<G | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (load.data) {
      setBase(load.data);
      setDraft(load.data);
    }
  }, [load.data]);
  const dirty = !!(base && draft && !same(base, draft));
  useLeaveGuard(dirty);
  const save = async () => {
    if (!draft || !dirty || busy) return;
    const body = clean(draft);
    const errs: Record<string, string> = zodErrors(GamificationBody, body);
    const lv = [...body.levels].sort((a, b) => a.n - b.n);
    if (lv[0] && lv[0].minPoints !== 0) errs['levels.0.minPoints'] = 'O primeiro nível começa em 0 ponto.';
    lv.forEach((l, i) => {
      const prev = lv[i - 1];
      if (prev && l.minPoints <= prev.minPoints)
        errs[`levels.${body.levels.indexOf(l)}.minPoints`] = 'Precisa ser maior que o do nível anterior.';
    });
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = tabOf(Object.keys(errs)[0] as string);
      if (first !== tab) setQuery({ aba: first });
      return toast('Há campos para corrigir.', 'warn');
    }
    setBusy(true);
    try {
      const res = await call(adminAiApi.setGamification, { body });
      setBase(res);
      setDraft(res);
      setSavedAt(Date.now());
      toast('Gamificação salva.');
    } catch (e) {
      const iss = issuesOf(e);
      if (iss.length) setErrors(issuesToErrors(iss));
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  useSaveShortcut(() => void save());
  return (
    <Page
      title="Gamificação"
      kicker="Conteúdo · regras"
      bar={
        <TabsNav label="Partes">
          {TABS.map(([t, l]) => (
            <a
              key={t}
              href={`#/conteudo/gamificacao?aba=${t}`}
              class={`ad-tab${t === tab ? ' on' : ''}`}
              aria-current={t === tab ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                setQuery({ aba: t });
              }}
            >
              {l}
            </a>
          ))}
        </TabsNav>
      }
    >
      <div class="ad-note">
        <Icon name="alert" size={18} /> Vale na hora para os próximos pontos. Os alunos veem os textos novos (níveis,
        medalhas) depois da próxima publicação. Vocabulário da marca: pontos, sequência, meta, medalha.
      </div>
      {load.error && !load.data ? (
        <ErrorBox error={load.error} retry={load.reload} />
      ) : !draft ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <ErrorSummary errors={errors} specs={ALL} idp="gm" />
          <section class="card ad-card">
            <Form
              specs={SPECS[tab] ?? []}
              value={draft}
              set={(fn) => setDraft((p) => (p ? fn(p) : p))}
              errors={errors}
              idp="gm"
            />
          </section>
          <SaveBar
            dirty={dirty}
            busy={busy}
            savedAt={savedAt}
            errors={Object.keys(errors).length}
            onSave={() => void save()}
            onDiscard={() => {
              setDraft(base);
              setErrors({});
            }}
          />
        </>
      )}
    </Page>
  );
}
