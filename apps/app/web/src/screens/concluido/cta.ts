import type { Episode } from '@tie/shared/content/schema';

/**
 * PROD (spec 05 "Concluído: the button always says something"): the done card's button text and route are
 * optional in the admin, and an empty text drew a blank orange button. Without a text the button opens the
 * route it has, or the next published episode ("Começar o Episódio 2"); with neither it is left out (the
 * "Voltar para Hoje" button stays).
 */
export function doneCta(
  dn: Pick<Episode['done'], 'cta' | 'go'>,
  num: number,
  episodes: readonly { num: number; status: string }[] | undefined,
): { label: string; go: string } | null {
  const go = dn.go.trim();
  if (dn.cta.trim()) return { label: dn.cta, go: go || 'inicio' };
  const target =
    go || (episodes?.some((e) => e.num === num + 1 && e.status === 'published') ? `episodio/${num + 1}` : '');
  if (!target) return null;
  const ep = /^episodio\/(\d+)/.exec(target)?.[1];
  return { label: ep ? `Começar o Episódio ${ep}` : 'Continuar', go: target };
}
