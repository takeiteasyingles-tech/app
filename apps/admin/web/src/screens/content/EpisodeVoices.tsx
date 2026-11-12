// Episode editor → "Vozes desta lição" (spec 05 "Lesson voices"): the ElevenLabs voice the lesson's audio
// is read with, on every tab where the learner taps to hear something. Narração: what no character says
// (Take a Look vocabulary, Take the Mic phrases, Take a Lesson words, Take Away, Take Action audio): one
// voice for the whole lesson, shown on each of those tabs. Personagens: one voice per character of the
// episode, for their Take It In lines. Geral shows both. Empty = the course voice (Configurações → Vozes).
// Reaches students at the next publish.
import { ELEVEN_NARRATOR_KEY } from '@tie/shared/constants';
import type { EpisodeVoices } from '@tie/shared/content/schema';
import { adminVoicesApi } from '@tie/shared/contracts/voices';
import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { can } from '../../session';
import type { CustomProps } from '../../ui/form';
import { Button, Field } from '../../ui/kit';
import { toast } from '../../ui/toast';
import { accountVoices, VoicePick } from '../../ui/voices';

/** Drops empty entries, so an untouched lesson stays `{}`. */
function clean(v: EpisodeVoices): EpisodeVoices {
  const out: EpisodeVoices = {};
  if (v.narrator) out.narrator = v.narrator;
  const steps = Object.fromEntries(Object.entries(v.steps ?? {}).filter(([, id]) => !!id));
  if (Object.keys(steps).length) out.steps = steps;
  const cast = Object.fromEntries(Object.entries(v.cast ?? {}).filter(([, id]) => !!id));
  if (Object.keys(cast).length) out.cast = cast;
  return out;
}

/**
 * "Usar em todas as lições": makes the chosen voice the course voice (Configurações → Vozes, settings.manage),
 * live for every lesson that does not set its own, with no publish. `who` = null for the narration, else
 * a character name, matched to its assistant by key or name. Hidden without settings.manage.
 */
function UseForAll({ voiceId, who }: { voiceId: string | null; who: string | null }) {
  const [busy, setBusy] = useState(false);
  if (!can('settings.manage')) return null;
  const apply = async () => {
    if (!voiceId) return;
    setBusy(true);
    try {
      let key: string = ELEVEN_NARRATOR_KEY;
      if (who) {
        const { settings } = await call(adminVoicesApi.get);
        const w = who.toLowerCase();
        const a = settings.assistants.find((x) => x.key.toLowerCase() === w || x.name.toLowerCase() === w);
        if (!a) {
          toast(`${who} não é um personagem com voz no curso (Configurações → Vozes).`, 'err');
          return;
        }
        key = a.key;
      }
      await call(adminVoicesApi.put, { body: { voices: { [key]: voiceId } } });
      toast(
        who
          ? `Esta é a voz de ${who} em todas as lições agora (as que não escolhem outra).`
          : 'Esta é a narração de todas as lições agora (as que não escolhem outra). Já vale para os alunos.',
      );
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Button
        label="Usar em todas as lições"
        kind="light"
        busy={busy}
        disabled={!voiceId || busy}
        title={voiceId ? 'Vira a voz do curso: vale na hora em toda lição sem voz própria' : 'Escolha uma voz'}
        onClick={() => void apply()}
      />
    </div>
  );
}

// ---------- What "the course voice" is (Configurações → Vozes) ----------

type Course = { voices: Record<string, string>; assistants: { key: string; name: string }[] };
let courseLoad: Promise<Course | null> | null = null;
/** The course voices, read once (staff with settings.manage; null for the others). */
function useCourse(): Course | null {
  const [c, setC] = useState<Course | null>(null);
  useEffect(() => {
    courseLoad ??= call(adminVoicesApi.get)
      .then((r) => ({ voices: r.settings.voices, assistants: r.settings.assistants }))
      .catch(() => null);
    void courseLoad.then(setC);
  }, []);
  return c;
}

/**
 * "Voz de Robert no curso: Brian" / "…: ID c5YCwn… fora da conta da ElevenLabs (toca a voz da IA)" /
 * "…: voz da IA". `who` null = the narration.
 */
function courseLabel(c: Course | null, who: string | null, base: string): string {
  if (!c) return base;
  const w = who?.toLowerCase();
  const key = w
    ? c.assistants.find((a) => a.key.toLowerCase() === w || a.name.toLowerCase() === w)?.key
    : ELEVEN_NARRATOR_KEY;
  const id = key ? c.voices[key] : undefined;
  if (!id) return `${base}: voz da IA (sem ElevenLabs)`;
  const list = accountVoices.value;
  if (!list) return `${base}: ID ${id.slice(0, 6)}…`;
  const v = list.find((x) => x.id === id);
  return v ? `${base}: ${v.name}` : `${base}: ID ${id.slice(0, 6)}… fora da conta da ElevenLabs (toca a voz da IA)`;
}

const NARRATION_USE =
  'Vocabulário do Take a Look, frases do Take the Mic, palavras do Take a Lesson, Take Away e Take Action';

type Show = 'all' | 'narration' | 'cast';

function LessonVoices({
  value,
  parent,
  set,
  id,
  err,
  show,
  step,
  stepN,
}: CustomProps & { show: Show; step?: string; stepN?: number }) {
  const course = useCourse();
  if (!can('content.edit')) return null;
  const v = (value && typeof value === 'object' ? value : {}) as EpisodeVoices;
  const castNames = Array.isArray(parent.castNames) ? (parent.castNames as string[]).filter(Boolean) : [];
  // A voice kept for someone no longer in the cast list still shows, so it can be removed.
  const names = [...castNames, ...Object.keys(v.cast ?? {}).filter((n) => !castNames.includes(n))];
  const dialog = Array.isArray(parent.dialog) ? (parent.dialog as { who?: string; en?: string }[]) : [];
  const visual = Array.isArray(parent.visual) ? (parent.visual as { en?: string }[]) : [];
  const words = visual
    .map((w) => w.en)
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');
  const lineOf = (name: string) => dialog.find((d) => d.who?.toLowerCase() === name.toLowerCase() && d.en)?.en;
  const setCast = (name: string, voiceId: string | null) =>
    set(clean({ ...v, cast: { ...(v.cast ?? {}), [name]: voiceId ?? '' } }));
  const label =
    show === 'cast'
      ? 'Vozes dos personagens nesta lição (ElevenLabs)'
      : show === 'narration'
        ? `Voz do áudio do ${step ?? 'etapa'} (ElevenLabs)`
        : 'Vozes desta lição (ElevenLabs)';
  const hint =
    show === 'narration'
      ? 'Só nesta etapa desta lição: quando o aluno toca para ouvir aqui, quem lê é esta voz. As outras etapas e lições não mudam. Sem escolha, vale a Narração da lição (aba Geral) e, sem ela, a voz do curso (Configurações → Vozes). Vale para os alunos assim que salvar.'
      : show === 'cast'
        ? 'Cada fala do Take It In sai com a voz do personagem escolhida aqui: uma voz clonada da conta ou uma da biblioteca da ElevenLabs. Sem escolha, vale a voz do personagem no curso (Configurações → Vozes). Vale para os alunos assim que salvar.'
        : 'A Narração daqui vale nas etapas desta lição que não escolheram uma voz própria (cada aba pode ter a sua). Os personagens falam com a voz escolhida para eles. Sem escolha, vale a voz do curso (Configurações → Vozes). Vale para os alunos assim que salvar.';
  // One step's own narration (steps[n]) on its tab; the lesson default (narrator) on Geral.
  const own = show === 'narration' && stepN != null;
  const narration = own ? (v.steps?.[String(stepN)] ?? null) : (v.narrator ?? null);
  const setNarration = (x: string | null) =>
    set(clean(own ? { ...v, steps: { ...(v.steps ?? {}), [String(stepN)]: x ?? '' } } : { ...v, narrator: x }));
  return (
    <Field id={`${id}-v0`} label={label} wide err={err} hint={hint}>
      <div class="stack" style={{ '--gap': '10px' }}>
        {show !== 'cast' ? (
          <div class="stack" style={{ '--gap': '4px' }}>
            <b class="sm">{own ? `Narração do ${step}` : 'Narração da lição (padrão)'}</b>
            {show === 'all' ? <span class="xs">{NARRATION_USE}, nas etapas sem voz própria.</span> : null}
            <VoicePick
              id={`${id}-v0`}
              value={narration}
              onValue={setNarration}
              emptyLabel={
                own && v.narrator ? 'Narração da lição (aba Geral)' : courseLabel(course, null, 'Voz do curso')
              }
              previewText={words ? `${words}.` : undefined}
            />
            <UseForAll voiceId={narration} who={null} />
          </div>
        ) : null}
        {show !== 'narration'
          ? names.map((name, i) => (
              <div key={name} class="stack" style={{ '--gap': '4px' }}>
                <b class="sm">
                  {name}
                  {castNames.includes(name) ? null : <span class="xs"> · fora da lista de personagens</span>}
                </b>
                <VoicePick
                  id={`${id}-v${i + 1}`}
                  value={v.cast?.[name] ?? null}
                  onValue={(x) => setCast(name, x)}
                  emptyLabel={courseLabel(course, name, `Voz de ${name} no curso`)}
                  previewText={lineOf(name)}
                />
                <UseForAll voiceId={v.cast?.[name] ?? null} who={name} />
              </div>
            ))
          : null}
        {show !== 'narration' && !names.length ? (
          <span class="xs">Adicione os personagens na aba Geral para escolher a voz de cada um.</span>
        ) : null}
      </div>
    </Field>
  );
}

/** Geral: the narration and every character. */
export function EpisodeVoicesField(p: CustomProps): VNode | null {
  return <LessonVoices {...p} show="all" />;
}

/** Take It In: one voice per character. */
export function CastVoicesField(p: CustomProps): VNode | null {
  return <LessonVoices {...p} show="cast" />;
}

/** A tab whose taps are read by the narration (Take a Look, Take the Mic, Take a Lesson, Take Away, Take Action). */
export const narrationVoiceField =
  (step: string, stepN: number) =>
  (p: CustomProps): VNode | null => <LessonVoices {...p} show="narration" step={step} stepN={stepN} />;
