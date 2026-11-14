// Episode → Take Some Extras → "Vozes" (spec 05 "Extras voices"): who speaks in this episode's extras.
// The extras' own voice (anyone speaking there without a voice of their own) and one voice per character
// (e.g. Margaret in Take the Lead); characters can be added freely, so a new one in the plot gets a voice
// too. Saved on the episode (voices.extras), live for learners as soon as it is saved. Unset = the
// course's extras voice (Configurações → Vozes → Voz dos extras).
import { ELEVEN_EXTRAS_KEY } from '@tie/shared/constants';
import type { EpisodeVoices } from '@tie/shared/content/schema';
import { adminContentApi } from '@tie/shared/contracts/admin';
import { adminVoicesApi } from '@tie/shared/contracts/voices';
import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { can } from '../../session';
import { useLoad } from '../../ui/async';
import { Async, Button, Field, TextIn } from '../../ui/kit';
import { toast } from '../../ui/toast';
import { accountVoices, VoicePick } from '../../ui/voices';

type Extras = NonNullable<EpisodeVoices['extras']>;

/** Drops empty entries, so an untouched episode keeps no `extras` key. */
function clean(x: Extras): Extras | undefined {
  const out: Extras = {};
  if (x.narrator) out.narrator = x.narrator;
  const cast = Object.fromEntries(Object.entries(x.cast ?? {}).filter(([n, id]) => !!n.trim() && !!id));
  if (Object.keys(cast).length) out.cast = cast;
  return Object.keys(out).length ? out : undefined;
}

const nameOf = (id: string | undefined): string | null => {
  if (!id) return null;
  return accountVoices.value?.find((v) => v.id === id)?.name ?? `ID ${id.slice(0, 6)}…`;
};

export function ExtrasVoices({ ep, lead }: { ep: number; lead?: string }): VNode | null {
  const load = useLoad((signal) => call(adminContentApi.episodes.get, { params: { id: String(ep) }, signal }), [ep]);
  const [course, setCourse] = useState<Record<string, string> | null>(null);
  const [x, setX] = useState<Extras>({});
  const [names, setNames] = useState<string[]>([]);
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call(adminVoicesApi.get)
      .then((r) => setCourse(r.settings.voices))
      .catch(() => setCourse(null));
  }, []);
  const saved = ((load.data?.item as { voices?: EpisodeVoices } | undefined)?.voices ?? {}) as EpisodeVoices;
  useEffect(() => {
    const e = saved.extras ?? {};
    setX(e);
    // Margaret leads Take the Lead: she is offered even before she has a voice here.
    const base = lead ? [lead] : [];
    setNames([...new Set([...base, ...Object.keys(e.cast ?? {})])]);
  }, [load.data]);
  if (!can('content.edit')) return null;
  const dirty = JSON.stringify(clean(x) ?? null) !== JSON.stringify(clean(saved.extras ?? {}) ?? null);
  const courseExtras = nameOf(course?.[ELEVEN_EXTRAS_KEY]);
  const save = async () => {
    setBusy(true);
    try {
      const next: EpisodeVoices = { ...saved };
      const e = clean(x);
      if (e) next.extras = e;
      else delete next.extras;
      const res = await call(adminContentApi.episodes.update, {
        params: { id: String(ep) },
        body: { voices: next } as never,
      });
      load.setData(() => ({ item: res.item as never }));
      toast('Vozes dos extras salvas. Já valem para os alunos.');
    } catch (err) {
      toast(errorMessage(err), 'err');
    } finally {
      setBusy(false);
    }
  };
  const addName = () => {
    const n = add.trim().slice(0, 40);
    if (!n) return;
    if (!names.some((m) => m.toLowerCase() === n.toLowerCase())) setNames([...names, n]);
    setAdd('');
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
              <VoicePick
                id="exv-0"
                value={x.narrator ?? null}
                onValue={(v) => setX({ ...x, narrator: v })}
                emptyLabel={
                  courseExtras ? `Voz dos extras do curso: ${courseExtras}` : 'Voz de cada personagem no curso'
                }
                previewText="Oh, hello! Good morning! Nice to meet you."
              />
            </div>
            {names.map((name, i) => (
              <div key={name} class="stack" style={{ '--gap': '4px' }}>
                <b class="sm">{name}</b>
                <VoicePick
                  id={`exv-${i + 1}`}
                  value={x.cast?.[name] ?? null}
                  onValue={(v) => setX({ ...x, cast: { ...(x.cast ?? {}), [name]: v ?? '' } })}
                  emptyLabel={nameOf(x.narrator ?? undefined) ? 'Voz dos extras deste episódio' : 'Voz dos extras'}
                  previewText={`Hi! I'm ${name}. Nice to meet you.`}
                />
              </div>
            ))}
            <div class="row wrapx" style={{ '--gap': '8px', alignItems: 'end' }}>
              <Field id="exv-add" label="Adicionar personagem">
                <TextIn
                  id="exv-add"
                  value={add}
                  onValue={setAdd}
                  placeholder="Ex.: Robert"
                  maxLength={40}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addName();
                    }
                  }}
                />
              </Field>
              <Button label="Adicionar" icon="plus" kind="light" disabled={!add.trim()} onClick={addName} />
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
