// Lesson voices (PROD 0016, episodes.voices): the ElevenLabs voices of one episode. The episode editor
// picks the lesson narration, one narration per step and one voice per character. Unset entries fall
// back to the course voices (Configurações → Vozes). The Take Some Extras voices live in
// EpisodeReferences; the three-way merge used on save lives in draftVoices.

import { ELEVEN_NARRATOR_KEY } from '@tie/shared/constants';
import type { EpisodeVoices } from '@tie/shared/content/schema';
import { adminVoicesApi } from '@tie/shared/contracts/voices';
import { useEffect, useState } from 'preact/hooks';
import { call, errorMessage } from '../../api';
import { can } from '../../session';
import type { CustomProps } from '../../ui/form';
import { Button, Field } from '../../ui/kit';
import { toast } from '../../ui/toast';
import { accountVoices, VoicePicker } from '../../ui/voices';

type Voices = EpisodeVoices;

interface CourseVoices {
  voices: Record<string, string>;
  assistants: { key: string; name: string }[];
}

/** Drops empty entries (a picker set back to "none") but keeps the extras untouched. */
function cleanVoices(v: Voices): Voices {
  const out: Voices = {};
  if (v.narrator) out.narrator = v.narrator;
  const steps = Object.fromEntries(Object.entries(v.steps ?? {}).filter(([, id]) => !!id));
  if (Object.keys(steps).length) out.steps = steps;
  const cast = Object.fromEntries(Object.entries(v.cast ?? {}).filter(([, id]) => !!id));
  if (Object.keys(cast).length) out.cast = cast;
  if (v.extras) out.extras = v.extras;
  return out;
}

/** "Usar em todas as lições": makes this voice the course voice of the narration or of `who`. */
function UseEverywhere({ voiceId, who }: { voiceId: string | null; who: string | null }) {
  const [busy, setBusy] = useState(false);
  if (!can('settings.manage')) return null;
  const run = async () => {
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
        onClick={() => void run()}
      />
    </div>
  );
}

let course: Promise<CourseVoices | null> | null = null;

/** The course voices (Configurações → Vozes), fetched once; null without settings.manage. */
function useCourseVoices(): CourseVoices | null {
  const [v, setV] = useState<CourseVoices | null>(null);
  useEffect(() => {
    course ??= call(adminVoicesApi.get)
      .then((r) => ({ voices: r.settings.voices, assistants: r.settings.assistants }))
      .catch(() => null);
    course.then(setV);
  }, []);
  return v;
}

/** Label of the "no voice" option: which course voice plays instead. */
function courseLabel(c: CourseVoices | null, who: string | null, fallback: string): string {
  if (!c) return fallback;
  const w = who?.toLowerCase();
  const key = w
    ? c.assistants.find((a) => a.key.toLowerCase() === w || a.name.toLowerCase() === w)?.key
    : ELEVEN_NARRATOR_KEY;
  const own = key ? c.voices[key] : undefined;
  const id = own ?? c.voices.default;
  const note = own ? '' : ' (voz padrão das aulas)';
  if (!id) return `${fallback}: voz genérica da IA (defina a voz padrão em Configurações → Vozes)`;
  const list = accountVoices.value;
  if (!list) return `${fallback}: ID ${id.slice(0, 6)}…${note}`;
  const v = list.find((x) => x.id === id);
  return v
    ? `${fallback}: ${v.name}${note}`
    : `${fallback}: ID ${id.slice(0, 6)}… fora da conta da ElevenLabs (toca a voz da IA)`;
}

const NARRATION_PARTS =
  'Vocabulário do Take a Look, frases do Take the Mic, palavras do Take a Lesson, Take Away e Take Action';

type Show = 'all' | 'cast' | 'narration';

/**
 * The `voices` field of the episode editor. `all` (tab Geral): the lesson narration and every
 * character; `cast` (Take It In): the characters; `narration`: one step's own narration.
 */
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
  const c = useCourseVoices();
  if (!can('content.edit')) return null;
  const v = (value && typeof value === 'object' ? value : {}) as Voices;
  const castNames = Array.isArray(parent.castNames) ? (parent.castNames as string[]).filter(Boolean) : [];
  const names = [...castNames, ...Object.keys(v.cast ?? {}).filter((n) => !castNames.includes(n))];
  const dialog = (Array.isArray(parent.dialog) ? parent.dialog : []) as { who?: string; en?: string }[];
  const words = ((Array.isArray(parent.visual) ? parent.visual : []) as { en?: string }[])
    .map((w) => w.en)
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');
  const lineOf = (who: string) => dialog.find((d) => d.who?.toLowerCase() === who.toLowerCase() && d.en)?.en;
  const setCast = (who: string, voice: string | null) =>
    set(cleanVoices({ ...v, cast: { ...(v.cast ?? {}), [who]: voice ?? '' } }));
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
  const ownStep = show === 'narration' && stepN != null;
  const narration = ownStep ? (v.steps?.[String(stepN)] ?? null) : (v.narrator ?? null);
  return (
    <Field id={`${id}-v0`} label={label} wide err={err} hint={hint}>
      <div class="stack" style={{ '--gap': '10px' }}>
        {show === 'cast' ? null : (
          <div class="stack" style={{ '--gap': '4px' }}>
            <b class="sm">{ownStep ? `Narração do ${step}` : 'Narração da lição (padrão)'}</b>
            {show === 'all' ? <span class="xs">{NARRATION_PARTS}, nas etapas sem voz própria.</span> : null}
            <VoicePicker
              id={`${id}-v0`}
              value={narration}
              onValue={(voice) =>
                set(
                  cleanVoices(
                    ownStep
                      ? { ...v, steps: { ...(v.steps ?? {}), [String(stepN)]: voice ?? '' } }
                      : { ...v, narrator: voice },
                  ),
                )
              }
              emptyLabel={
                ownStep && v.narrator ? 'Narração da lição (aba Geral)' : courseLabel(c, null, 'Voz do curso')
              }
              previewText={words ? `${words}.` : undefined}
            />
            <UseEverywhere voiceId={narration} who={null} />
          </div>
        )}
        {show === 'narration'
          ? null
          : names.map((who, i) => (
              <div key={who} class="stack" style={{ '--gap': '4px' }}>
                <b class="sm">
                  {who}
                  {castNames.includes(who) ? null : <span class="xs"> · fora da lista de personagens</span>}
                </b>
                <VoicePicker
                  id={`${id}-v${i + 1}`}
                  value={v.cast?.[who] ?? null}
                  onValue={(voice) => setCast(who, voice)}
                  emptyLabel={courseLabel(c, who, `Voz de ${who} no curso`)}
                  previewText={lineOf(who)}
                />
                <UseEverywhere voiceId={v.cast?.[who] ?? null} who={who} />
              </div>
            ))}
        {show !== 'narration' && !names.length ? (
          <span class="xs">Adicione os personagens na aba Geral para escolher a voz de cada um.</span>
        ) : null}
      </div>
    </Field>
  );
}

/** Tab Geral: the lesson narration and every character. */
export function AllVoices(p: CustomProps) {
  return <LessonVoices {...p} show="all" />;
}

/** Take It In: the characters' voices. */
export function CastVoices(p: CustomProps) {
  return <LessonVoices {...p} show="cast" />;
}

/** One step's own narration (`step` names it in the copy, `stepN` is its number). */
export const stepVoices = (step: string, stepN: number) => (p: CustomProps) => (
  <LessonVoices {...p} show="narration" step={step} stepN={stepN} />
);
