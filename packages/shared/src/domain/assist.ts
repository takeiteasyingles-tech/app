import type { AssistantPublic } from '../content/schema';

// TIE.assist helpers (prototipo/js/data/assistants.js) over the catalog's assistant list.

export type AssistantRef = Pick<AssistantPublic, 'k' | 'name' | 'art'>;

/** Chosen assistant, or the first one (Maggie) when the key is missing or unknown. */
export function getAssistant<A extends AssistantRef>(list: readonly A[], k: string | null | undefined): A {
  const found = list.find((a) => a.k === k) ?? list[0];
  if (!found) throw new Error('assistant list is empty');
  return found;
}

/** Portuguese article + name: "a Maggie", "o Robert". */
export const assistantThe = (a: AssistantRef): string => `${a.art} ${a.name}`;

/** Capitalized: "A Maggie", "O Robert". */
export const assistantTheCap = (a: AssistantRef): string => {
  const t = assistantThe(a);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "da Maggie", "do Robert". */
export const assistantOf = (a: AssistantRef): string => (a.art === 'a' ? 'da ' : 'do ') + a.name;

/** Finds an assistant by any of its names (case-insensitive), e.g. a dialog speaker. */
export function assistantByName<A extends Pick<AssistantPublic, 'aka'>>(list: readonly A[], who: unknown): A | null {
  const w = String(who || '').toLowerCase();
  return list.find((a) => a.aka.some((n) => n.toLowerCase() === w)) ?? null;
}
