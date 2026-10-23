import { adminContentApi as C } from '@tie/shared/contracts/admin';
import { call } from '../../api';
import { useLoad } from '../../ui/async';
import type { CustomProps } from '../../ui/form';
import { Async, Field, Sel } from '../../ui/kit';

/** Existing unassigned extras can be reused without exposing another global CMS menu. */
export function EpisodeExtraPicker({ value, parent, set, id, err }: CustomProps) {
  const load = useLoad(
    async (signal) => {
      const [extras, episodes] = await Promise.all([
        call(C.extras.list, { query: {}, signal }),
        call(C.episodes.list, { query: {}, signal }),
      ]);
      const owned = new Set(episodes.items.filter((ep) => ep.num !== parent.num).map((ep) => ep.extraId));
      return extras.items.filter((extra) => !owned.has(extra.id));
    },
    [parent.num],
  );
  return (
    <Field
      id={id}
      label="Extra do episódio"
      err={err}
      wide
      hint="Materiais exclusivos: extras já vinculados a outro episódio não aparecem."
    >
      <Async load={load}>
        {(items) => (
          <Sel
            id={id}
            value={String(value ?? '')}
            onValue={(next) => set(next || null)}
            options={[
              ['', 'Selecione o extra deste episódio'],
              ...items.map(
                (extra) =>
                  [extra.id, `${extra.title} · ${extra.status === 'draft' ? 'Rascunho' : 'Publicado'}`] as const,
              ),
            ]}
          />
        )}
      </Async>
    </Field>
  );
}
