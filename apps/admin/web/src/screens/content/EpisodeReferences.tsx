// What an episode references outside its own row: the voices of its Take Some Extras (voices.extras,
// edited from the e-book editor) and its exclusive extra.

import { ELEVEN_EXTRAS_KEY } from '@tie/shared/constants';
import type { EpisodeVoices } from '@tie/shared/content/schema';
import { adminContentApi as C } from '@tie/shared/contracts/admin';
import { adminVoicesApi } from '@tie/shared/contracts/voices';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { can } from '../../session';
import { useLoad } from '../../ui/async';
import type { CustomProps } from '../../ui/form';
import { Async, Button, Field, Sel, TextIn } from '../../ui/kit';
import { toast } from '../../ui/toast';
import { accountVoices, VoicePicker } from '../../ui/voices';
import { mergeEpisodeVoices } from './draftVoices';

type ExtrasVoices = NonNullable<EpisodeVoices['extras']>;

// ---------- Take Some Extras voices ----------

function cleanExtras(v: ExtrasVoices): ExtrasVoices | undefined {
  const out: ExtrasVoices = {};
  if (v.narrator) out.narrator = v.narrator;
  const cast = Object.fromEntries(Object.entries(v.cast ?? {}).filter(([who, id]) => !!who.trim() && !!id));
  if (Object.keys(cast).length) out.cast = cast;
  return Object.keys(out).length ? out : undefined;
}

/** Name of an account voice, or a short id when the account list does not have it. */
const voiceName = (id: string | null | undefined): string | null =>
  id ? (accountVoices.value?.find((v) => v.id === id)?.name ?? `ID ${id.slice(0, 6)}…`) : null;

/**
 * Voices of this episode's Take Some Extras (voices.extras), saved on their own with the episode
 * (the rest of the extras editor saves the e-book row). `lead` = the character of Take the Lead.
 */
export function ExtrasVoicesEditor({ ep, lead }: { ep: number; lead?: string }) {
  const load = useLoad((signal) => call(C.episodes.get, { params: { id: String(ep) }, signal }), [ep]);
  const [courseSet, setCourseSet] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState<ExtrasVoices>({});
  const [names, setNames] = useState<string[]>([]);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call(adminVoicesApi.get)
      .then((r) => setCourseSet(r.settings.voices))
      .catch(() => setCourseSet(null));
  }, []);
  const saved: EpisodeVoices = load.data?.item?.voices ?? {};
  useEffect(() => {
    const ex = saved.extras ?? {};
    setDraft(ex);
    setNames([...new Set([...(lead ? [lead] : []), ...Object.keys(ex.cast ?? {})])]);
  }, [load.data]);
  if (!can('content.edit')) return null;
  const dirty = JSON.stringify(cleanExtras(draft) ?? null) !== JSON.stringify(cleanExtras(saved.extras ?? {}) ?? null);
  const courseExtras = voiceName(courseSet?.[ELEVEN_EXTRAS_KEY]);
  const save = async () => {
    setBusy(true);
    try {
      const server = (await call(C.episodes.get, { params: { id: String(ep) } })).item;
      const next = cleanExtras(draft);
      const voices = mergeEpisodeVoices(server.voices, { extras: saved.extras }, next ? { extras: next } : {});
      const res = await call(C.episodes.update, { params: { id: String(ep) }, body: { voices } });
      load.setData(() => ({ item: res.item }));
      toast('Vozes dos extras salvas. Já valem para os alunos.');
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const n = adding.trim().slice(0, 40);
    if (!n) return;
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) setNames([...names, n]);
    setAdding('');
  };
  return (
    <Async load={load}>
      {() => (
        <Field
          id="exv-0"
          label="Vozes dos extras deste episódio (ElevenLabs)"
          wide
          hint="Quem fala nos Take Some Extras deste episódio. A voz dos extras vale para todos que falam aqui; cada personagem pode ter a sua. Sem escolha, vale a Voz dos extras do curso (Configurações → Vozes) e, sem ela, a voz do personagem no curso. Vale para os alunos assim que salvar. O agente do MCP também pode trocar e adicionar estas vozes (update_episode → voices.extras)."
        >
          <div class="stack" style={{ '--gap': '12px' }}>
            <div class="stack" style={{ '--gap': '4px' }}>
              <b class="sm">Voz dos extras (padrão deste episódio)</b>
              <VoicePicker
                id="exv-0"
                value={draft.narrator ?? null}
                onValue={(voice) => setDraft({ ...draft, narrator: voice })}
                emptyLabel={
                  courseExtras ? `Voz dos extras do curso: ${courseExtras}` : 'Voz de cada personagem no curso'
                }
                previewText="Oh, hello! Good morning! Nice to meet you."
              />
            </div>
            {names.map((who, i) => (
              <div key={who} class="stack" style={{ '--gap': '4px' }}>
                <b class="sm">{who}</b>
                <VoicePicker
                  id={`exv-${i + 1}`}
                  value={draft.cast?.[who] ?? null}
                  onValue={(voice) => setDraft({ ...draft, cast: { ...(draft.cast ?? {}), [who]: voice ?? '' } })}
                  emptyLabel={
                    voiceName(draft.narrator ?? undefined) ? 'Voz dos extras deste episódio' : 'Voz dos extras'
                  }
                  previewText={`Hi! I'm ${who}. Nice to meet you.`}
                />
              </div>
            ))}
            <div class="row wrapx" style={{ '--gap': '8px', alignItems: 'end' }}>
              <Field id="exv-add" label="Adicionar personagem">
                <TextIn
                  id="exv-add"
                  value={adding}
                  onValue={setAdding}
                  placeholder="Ex.: Robert"
                  maxLength={40}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      add();
                    }
                  }}
                />
              </Field>
              <Button label="Adicionar" icon="plus" kind="light" disabled={!adding.trim()} onClick={add} />
              <Button
                label="Salvar vozes"
                icon="check"
                busy={busy}
                disabled={!dirty || busy}
                onClick={() => void save()}
              />
            </div>
          </div>
        </Field>
      )}
    </Async>
  );
}

// ---------- exclusive extra ----------

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
