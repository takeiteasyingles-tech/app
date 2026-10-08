// Dialogs: tie.css's .overlay/.sheet (a bottom sheet on phones, a centred card on desktop) portalled
// into #overlayroot so it covers the whole .app. Focus moves in, Tab stays inside, Escape closes and
// focus returns to the opener. confirmAction() is the promise-based confirmation used by every
// destructive action (optional reason field and type-to-confirm).
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../api';
import { Icon } from './icons';
import { Area, Button, Field, TextIn } from './kit';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  title: ComponentChildren;
  onClose: () => void;
  children?: ComponentChildren;
  foot?: ComponentChildren;
  /** Wider sheet on desktop (editors, previews). */
  size?: 'md' | 'lg' | 'xl';
  /** Escape / scrim do nothing (a request is running). */
  locked?: boolean;
  /** Extra class on the sheet (e.g. the navy menu sheet). */
  cls?: string;
}

export function Modal({ title, onClose, children, foot, size = 'md', locked, cls = '' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el) {
      const first =
        el.querySelector<HTMLElement>('[data-autofocus]') ??
        el.querySelector<HTMLElement>(`.ad-sheet-body ${FOCUSABLE}`) ??
        el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus();
    }
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!lockedRef.current) closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const host = document.getElementById('overlayroot') ?? document.body;
  return createPortal(
    <div class="overlay ad-overlay">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse-only shortcut; Esc and the Fechar button cover the keyboard. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: same as above. */}
      <div class="scrim" onClick={() => !lockedRef.current && closeRef.current()} />
      <div
        ref={ref}
        class={`sheet ad-sheet ad-${size} ${cls}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div class="grab" aria-hidden="true" />
        <div class="ad-sheet-h">
          <h2 class="h2 grow" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            class="iconbtn"
            aria-label="Fechar"
            disabled={locked}
            onClick={() => closeRef.current()}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div class="ad-sheet-body stack">{children}</div>
        {foot ? <div class="ad-sheet-foot">{foot}</div> : null}
      </div>
    </div>,
    host,
  );
}

// ---------- confirmAction ----------

export interface ConfirmOpts {
  title: string;
  body?: ComponentChildren;
  confirm: string;
  danger?: boolean;
  /** Ask for a reason (sent to the audit log). */
  reason?: { label: string; required?: boolean; placeholder?: string };
  /** The person types this exact text to enable the button (deletions). */
  typeToConfirm?: string;
  /** Runs inside the dialog with its busy state; a thrown error stays in the dialog. */
  run?: (reason: string) => Promise<unknown>;
}

interface Pending extends ConfirmOpts {
  resolve: (v: { reason: string } | null) => void;
}

const pending = signal<Pending | null>(null);

/** Resolves {reason} when confirmed (after `run` succeeds, when given) or null when cancelled. */
export function confirmAction(opts: ConfirmOpts): Promise<{ reason: string } | null> {
  return new Promise((resolve) => {
    pending.value = { ...opts, resolve };
  });
}

function ConfirmDialog({ p }: { p: Pending }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const needReason = !!p.reason?.required && reason.trim() === '';
  const needType = !!p.typeToConfirm && typed.trim() !== p.typeToConfirm;
  const close = (v: { reason: string } | null) => {
    pending.value = null;
    p.resolve(v);
  };
  const ok = async () => {
    if (needReason || needType) return;
    if (!p.run) return close({ reason: reason.trim() });
    setBusy(true);
    setErr(null);
    try {
      await p.run(reason.trim());
      close({ reason: reason.trim() });
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={p.title}
      onClose={() => close(null)}
      locked={busy}
      foot={
        <>
          <Button label="Cancelar" kind="light" onClick={() => close(null)} disabled={busy} />
          <Button
            label={p.confirm}
            kind={p.danger ? 'ad-danger' : 'navy'}
            busy={busy}
            disabled={needReason || needType}
            onClick={() => void ok()}
          />
        </>
      }
    >
      {p.body ? <div class="p">{p.body}</div> : null}
      {p.reason ? (
        <Field id={`${id}-r`} label={p.reason.label} opt={!p.reason.required}>
          <Area
            id={`${id}-r`}
            value={reason}
            onValue={setReason}
            rows={3}
            maxLength={500}
            placeholder={p.reason.placeholder}
          />
        </Field>
      ) : null}
      {p.typeToConfirm ? (
        <Field id={`${id}-t`} label={`Para confirmar, digite: ${p.typeToConfirm}`}>
          <TextIn id={`${id}-t`} value={typed} onValue={setTyped} autoComplete="off" spellcheck={false} />
        </Field>
      ) : null}
      {err ? (
        <div class="fb err" role="alert">
          {err}
        </div>
      ) : null}
    </Modal>
  );
}

/** Rendered once by the shell. */
export function DialogHost() {
  const p = pending.value;
  return p ? <ConfirmDialog key={p.title} p={p} /> : null;
}
