import { activator } from './act';

/** The public assistant fields the picker needs (AssistantPublic from the catalog). */
export type PickerAssistant = {
  k: string;
  name: string;
  full: string;
  tag: string;
  /** Face thumbnail; present only when the assistant has video clips. */
  thumb?: string | null;
  clips?: Readonly<Record<string, string | undefined>>;
};

const hasClips = (a: PickerAssistant): boolean => !!a.clips && Object.values(a.clips).some(Boolean);

/** Initials shown when an assistant has no clips: first letter of the name + of the last surname. */
export function assistInitials(a: Pick<PickerAssistant, 'name' | 'full'>): string {
  return (a.name[0] ?? '') + (a.full.split(' ').slice(-1)[0]?.[0] ?? '');
}

/** TIE.avatar.thumb: thumbnail image, or initials in an .av-ini circle. */
export function AssistThumb({ a, size = 60 }: { a: PickerAssistant; size?: number }) {
  return hasClips(a) && a.thumb ? (
    <img src={a.thumb} alt="" />
  ) : (
    <span class="av-ini" style={{ '--s': `${size}px` }}>
      {assistInitials(a)}
    </span>
  );
}

export type AssistPickerProps = {
  list: readonly PickerAssistant[];
  /** Key of the current assistant. */
  cur: string;
  onPick: (key: string) => void;
};

/** C.assistPicker: radiogroup of assistants (Mic screen and Perfil). */
export function AssistPicker({ list, cur, onPick }: AssistPickerProps) {
  return (
    <div class="assist-row" role="radiogroup" aria-label="Seu assistente">
      {list.map((a) => (
        // biome-ignore lint/a11y/useSemanticElements: the prototype's radiogroup of buttons; tie.css styles .assist buttons.
        <button
          type="button"
          key={a.k}
          class={`assist${a.k === cur ? ' on' : ''}`}
          role="radio"
          aria-checked={a.k === cur ? 'true' : 'false'}
          onClick={activator(undefined, () => onPick(a.k))}
        >
          <AssistThumb a={a} />
          <b>{a.name}</b>
          <span>{a.tag}</span>
        </button>
      ))}
    </div>
  );
}
