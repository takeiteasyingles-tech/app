// Termos de Uso / Política de Privacidade (PROD: replaces the prototype's "Protótipo: nenhum dado sai
// do seu navegador." footer). Opened by `?doc=termos|privacidade` on the auth routes, so the link is
// shareable and Back closes it. The copy states what the platform actually does with the data.
import { Icon } from '@tie/ui';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Overlay } from '../../frame';
import { replace } from '../../router';
import { authConfig } from './turnstile';

export type LegalDoc = 'termos' | 'privacidade';

export const isLegalDoc = (v: string | undefined): v is LegalDoc => v === 'termos' || v === 'privacidade';

const DOCS: Record<LegalDoc, { title: string; items: string[] }> = {
  termos: {
    title: 'Termos de Uso',
    items: [
      'O Take It Easy é um curso de inglês em episódios, com conversas no Mic com assistentes de IA.',
      'A conta é pessoal. Não compartilhe a sua senha com ninguém.',
      'O primeiro episódio é grátis para sempre. O seu plano define quantos minutos de conversa no Mic você tem por mês.',
      'Respeito vale nas conversas e na foto do perfil. O que fere essas regras é revisado pela equipe e pode ser removido.',
      'A IA pode errar. Use as correções como treino e, na dúvida, confira na aula do episódio.',
    ],
  },
  privacidade: {
    title: 'Política de Privacidade',
    items: [
      'Guardamos o seu nome, a data de nascimento, o e-mail, as respostas do cadastro e o seu progresso no curso.',
      'O áudio que você grava serve só para dar a nota da pronúncia. Ele não fica guardado.',
      'O texto das conversas no Mic fica guardado por um tempo limitado, para o relatório e para a segurança, e depois é apagado.',
      'A sua foto de perfil é privada: só você e a equipe de revisão a veem.',
      'No seu perfil você baixa uma cópia dos seus dados ou exclui a sua conta quando quiser, como garante a LGPD.',
    ],
  },
};

/** The sheet container takes focus only so its name is announced; it is not a control, so no ring. */
export const SHEET_FOCUS = { outline: 'none' };

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard and screen-reader behaviour of a `.sheet` dialog (role=dialog, aria-modal): focus moves
 * into it on open (its first text field, else the sheet itself, so its name is read), Tab stays
 * inside it, Escape closes it, and focus goes back to the control that opened it on close.
 * Returns the ref for the `.sheet` element (give it tabIndex={-1}).
 */
export function useModal(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    const items = (): HTMLElement[] =>
      el ? Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.getClientRects().length > 0) : [];
    const first = el?.querySelector<HTMLElement>('input:not([disabled])') ?? el;
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (!el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = items();
      const head = list[0];
      const tail = list[list.length - 1];
      if (!head || !tail) {
        e.preventDefault();
        el.focus();
        return;
      }
      const at = document.activeElement;
      const inside = at instanceof Node && el.contains(at);
      if (e.shiftKey && (!inside || at === head || at === el)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (!inside || at === tail)) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

/** Bold and underlined, so the two documents stand out in the small legal line. */
const LINK = { whiteSpace: 'nowrap', fontWeight: '700', textDecoration: 'underline', textUnderlineOffset: '2px' };

/** Inline link that opens a document on the current auth route. */
export function LegalLink({ path, doc, children }: { path: string; doc: LegalDoc; children: ComponentChildren }) {
  return (
    <a href={`#/${path}?doc=${doc}`} style={LINK}>
      {children}
    </a>
  );
}

export function LegalSheet({ path, doc }: { path: string; doc: LegalDoc }) {
  const d = DOCS[doc];
  const [version, setVersion] = useState('');
  useEffect(() => {
    let alive = true;
    authConfig().then(
      (c) => alive && setVersion(c.termsVersion),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);
  const close = () => replace(path);
  const ref = useModal(close);
  return (
    <Overlay>
      <div class="overlay">
        <div class="scrim" onClick={close} aria-hidden="true" />
        <div
          class="sheet"
          role="dialog"
          aria-modal="true"
          aria-label={d.title}
          tabIndex={-1}
          ref={ref}
          style={SHEET_FOCUS}
        >
          <div class="grab" />
          <div class="row between top">
            <div>
              <div class="lbl">Take It Easy</div>
              <div class="h2 mt4">{d.title}</div>
            </div>
            <button type="button" class="iconbtn" aria-label="Fechar" onClick={close}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div class="stack mt12" style={{ '--gap': '10px' }}>
            {d.items.map((t) => (
              <div key={t} class="row top" style={{ '--gap': '10px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: 'var(--orange)',
                    flex: 'none',
                    marginTop: '9px',
                  }}
                />
                <span class="p-read">{t}</span>
              </div>
            ))}
            {version ? <p class="xs">Versão {version}</p> : null}
          </div>
        </div>
      </div>
    </Overlay>
  );
}
