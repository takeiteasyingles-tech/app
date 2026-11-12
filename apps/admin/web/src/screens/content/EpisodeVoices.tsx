// Episode editor → Geral → "Vozes desta lição" (spec 05 "Lesson voices"): the ElevenLabs voice the
// lesson's audio is read with. Narração: what no character says (vocabulary, Mic phrases, Take Away,
// exercises). Then one voice per character of the episode (Personagens), used for their dialogue lines.
// Empty = the course voice (Configurações → Vozes). Reaches students at the next publish.
import type { EpisodeVoices } from '@tie/shared/content/schema';
import { can } from '../../session';
import type { CustomProps } from '../../ui/form';
import { Field } from '../../ui/kit';
import { VoicePick } from '../../ui/voices';

/** Drops empty entries, so an untouched lesson stays `{}`. */
function clean(v: EpisodeVoices): EpisodeVoices {
  const out: EpisodeVoices = {};
  if (v.narrator) out.narrator = v.narrator;
  const cast = Object.fromEntries(Object.entries(v.cast ?? {}).filter(([, id]) => !!id));
  if (Object.keys(cast).length) out.cast = cast;
  return out;
}

export function EpisodeVoicesField({ value, parent, set, id, err }: CustomProps) {
  const v = (value && typeof value === 'object' ? value : {}) as EpisodeVoices;
  const castNames = Array.isArray(parent.castNames) ? (parent.castNames as string[]).filter(Boolean) : [];
  // A voice kept for someone no longer in the cast list still shows, so it can be removed.
  const names = [...castNames, ...Object.keys(v.cast ?? {}).filter((n) => !castNames.includes(n))];
  const dialog = Array.isArray(parent.dialog) ? (parent.dialog as { who?: string; en?: string }[]) : [];
  const visual = Array.isArray(parent.visual) ? (parent.visual as { en?: string }[]) : [];
  const narrationLine = visual
    .map((w) => w.en)
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');
  const lineOf = (name: string) => dialog.find((d) => d.who?.toLowerCase() === name.toLowerCase() && d.en)?.en;
  const setCast = (name: string, voiceId: string | null) =>
    set(clean({ ...v, cast: { ...(v.cast ?? {}), [name]: voiceId ?? '' } }));
  if (!can('content.edit')) return null;
  return (
    <Field
      id={`${id}-narr`}
      label="Vozes desta lição (ElevenLabs)"
      wide
      err={err}
      hint="Cada áudio que o aluno toca nesta lição sai com a voz escolhida aqui: uma voz clonada da conta ou uma da biblioteca da ElevenLabs. Sem escolha, vale a voz do curso (Configurações → Vozes). Muda para os alunos depois de publicar."
    >
      <div class="stack" style={{ '--gap': '10px' }}>
        <div class="stack" style={{ '--gap': '4px' }}>
          <b class="sm">Narração</b>
          <span class="xs">Vocabulário visual, frases do Take the Mic, Take Away e áudios dos exercícios.</span>
          <VoicePick
            id={`${id}-narr`}
            value={v.narrator ?? null}
            onValue={(x) => set(clean({ ...v, narrator: x }))}
            emptyLabel="Voz do curso"
            previewText={narrationLine ? `${narrationLine}.` : undefined}
          />
        </div>
        {names.map((name, i) => (
          <div key={name} class="stack" style={{ '--gap': '4px' }}>
            <b class="sm">
              {name}
              {castNames.includes(name) ? null : <span class="xs"> · fora da lista de personagens</span>}
            </b>
            <VoicePick
              id={`${id}-c${i}`}
              value={v.cast?.[name] ?? null}
              onValue={(x) => setCast(name, x)}
              emptyLabel={`Voz de ${name} no curso`}
              previewText={lineOf(name)}
            />
          </div>
        ))}
        {names.length ? null : <span class="xs">Adicione os personagens acima para escolher a voz de cada um.</span>}
      </div>
    </Field>
  );
}
