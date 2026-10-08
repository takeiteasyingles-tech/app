// Building blocks of every admin screen, on top of tie.css: the page frame (topbar + scroll + wrap),
// cards, buttons, inputs, pills, KPI tiles and the empty / loading / error states.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { errorMessage, isCode } from '../api';
import { Icon } from './icons';
import { menuOpen, setTitle, wide } from './layout';

// ---------- Page ----------

export interface PageProps {
  title: string;
  kicker?: string;
  /** Hash path of the back button. */
  back?: string;
  actions?: ComponentChildren;
  /** .wrap max width (default 1180px). */
  width?: number;
  children?: ComponentChildren;
  /** Content below the topbar that does not scroll (tabs, filters). */
  bar?: ComponentChildren;
}

export function Page({ title, kicker, back, actions, width = 1180, children, bar }: PageProps) {
  const mobile = !wide.value;
  useEffect(() => setTitle(title), [title]);
  return (
    <>
      <header class="topbar ad-top">
        {mobile && !back ? (
          <button
            type="button"
            class="iconbtn"
            aria-label="Abrir o menu"
            aria-expanded={menuOpen.value ? 'true' : 'false'}
            onClick={() => {
              menuOpen.value = true;
            }}
          >
            <Icon name="menu" size={20} />
          </button>
        ) : null}
        {back ? (
          <a class="iconbtn" href={`#/${back}`} aria-label="Voltar">
            <Icon name="back" size={20} />
          </a>
        ) : null}
        <div class="ttl">
          {kicker ? <div class="lbl">{kicker}</div> : null}
          <h1 class="h2 ad-title">{title}</h1>
        </div>
        {actions ? <div class="row ad-actions">{actions}</div> : null}
      </header>
      {bar ? <div class="ad-bar">{bar}</div> : null}
      <div class="scroll" id="main" tabIndex={-1}>
        <div class="wrap stack ad-wrap" style={{ '--wrap': `${width}px`, '--gap': '18px' }}>
          {children}
        </div>
      </div>
    </>
  );
}

// ---------- Cards and sections ----------

export function Card({
  title,
  sub,
  actions,
  children,
  cls = '',
  id,
}: {
  title?: ComponentChildren;
  sub?: ComponentChildren;
  actions?: ComponentChildren;
  children?: ComponentChildren;
  cls?: string;
  id?: string;
}) {
  return (
    <section class={`card ad-card ${cls}`} id={id}>
      {title || actions ? (
        <div class="ad-card-h">
          <div class="grow">
            {title ? <h2 class="h3">{title}</h2> : null}
            {sub ? <div class="xs mt4">{sub}</div> : null}
          </div>
          {actions ? <div class="row ad-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ---------- Buttons ----------

export interface ButtonProps {
  label?: ComponentChildren;
  icon?: string;
  iconR?: string;
  /** tie.css variants: navy, blue, green, light, ghost, link, danger (admin). */
  kind?: string;
  onClick?: (ev: MouseEvent) => void;
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  ariaLabel?: string;
  small?: boolean;
  block?: boolean;
  id?: string;
  form?: string;
}

export function Button({
  label,
  icon,
  iconR,
  kind = 'navy',
  onClick,
  disabled,
  busy,
  type = 'button',
  title,
  ariaLabel,
  small = true,
  block,
  id,
  form,
}: ButtonProps) {
  return (
    <button
      type={type}
      id={id}
      form={form}
      class={`btn ${small ? 'compact' : ''} ${kind} ${block ? 'block' : ''} ${label ? '' : 'ad-icon-only'}`}
      disabled={disabled || busy}
      aria-busy={busy ? 'true' : undefined}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={18} /> : null}
      {label ? <span>{label}</span> : null}
      {iconR ? <Icon name={iconR} size={18} /> : null}
    </button>
  );
}

/** Link styled as a button (navigation keeps real hrefs: middle-click, copy link). */
export function LinkButton({ href, label, icon, kind = 'light' }: { href: string; label: string; icon?: string; kind?: string }) {
  return (
    <a class={`btn compact ${kind}`} href={`#/${href}`}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{label}</span>
    </a>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  cls = '',
}: {
  icon: string;
  label: string;
  onClick: (ev: MouseEvent) => void;
  disabled?: boolean;
  cls?: string;
}) {
  return (
    <button type="button" class={`ad-ib ${cls}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={17} />
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span class="ad-spin" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />;
}

// ---------- Inputs ----------

export function Field({
  label,
  hint,
  err,
  id,
  children,
  opt,
  wide: isWide,
  cls = '',
}: {
  label: ComponentChildren;
  hint?: ComponentChildren;
  err?: string | null;
  id: string;
  children: ComponentChildren;
  opt?: boolean;
  wide?: boolean;
  cls?: string;
}) {
  return (
    <div class={`field ad-f ${isWide ? 'ad-span' : ''} ${cls}`}>
      <label for={id}>
        {label}
        {opt ? <i class="ad-opt">opcional</i> : null}
      </label>
      {children}
      {hint ? (
        <small class="xs" id={`${id}-hint`}>
          {hint}
        </small>
      ) : null}
      {err ? (
        <span class="err" id={`${id}-err`} role="alert">
          {err}
        </span>
      ) : null}
    </div>
  );
}

type InputAttrs = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'onInput' | 'value'>;

export function TextIn({
  id,
  value,
  onValue,
  err,
  ...rest
}: InputAttrs & { id: string; value: string; onValue: (v: string) => void; err?: string | null }) {
  return (
    <input
      {...rest}
      id={id}
      class={`input ad-in ${rest.class ?? ''}`}
      value={value}
      aria-invalid={err ? 'true' : undefined}
      aria-describedby={err ? `${id}-err` : undefined}
      onInput={(e) => onValue((e.currentTarget as HTMLInputElement).value)}
    />
  );
}

export function Area({
  id,
  value,
  onValue,
  rows = 3,
  err,
  placeholder,
  mono,
  maxLength,
}: {
  id: string;
  value: string;
  onValue: (v: string) => void;
  rows?: number;
  err?: string | null;
  placeholder?: string;
  mono?: boolean;
  maxLength?: number;
}) {
  return (
    <textarea
      id={id}
      class={`input ad-in ad-area ${mono ? 'ad-mono' : ''}`}
      rows={rows}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-invalid={err ? 'true' : undefined}
      aria-describedby={err ? `${id}-err` : undefined}
      onInput={(e) => onValue((e.currentTarget as HTMLTextAreaElement).value)}
    />
  );
}

export function Sel({
  id,
  value,
  onValue,
  options,
  err,
  ariaLabel,
  cls = '',
}: {
  id?: string;
  value: string;
  onValue: (v: string) => void;
  options: readonly (readonly [string, string])[];
  err?: string | null;
  ariaLabel?: string;
  cls?: string;
}) {
  return (
    <select
      id={id}
      class={`input ad-in ad-sel ${cls}`}
      value={value}
      aria-label={ariaLabel}
      aria-invalid={err ? 'true' : undefined}
      onChange={(e) => onValue((e.currentTarget as HTMLSelectElement).value)}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** C.toggle (role=switch), with its visible label for the click target. */
export function Switch({
  on,
  onChange,
  label,
  id,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      class={`toggle${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on ? 'true' : 'false'}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  );
}

export function SearchBox({
  value,
  onValue,
  placeholder = 'Buscar',
  id = 'busca',
}: {
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
  id?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <form
      class="ad-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onValue(v.trim());
      }}
    >
      <Icon name="search" size={18} />
      <input
        id={id}
        class="input ad-in"
        type="search"
        value={v}
        placeholder={placeholder}
        aria-label={placeholder}
        onInput={(e) => setV((e.currentTarget as HTMLInputElement).value)}
        onBlur={() => {
          if (v.trim() !== value) onValue(v.trim());
        }}
      />
    </form>
  );
}

/** tie.css .seg as a set of pressed buttons. */
export function Seg<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: readonly (readonly [V, string])[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div class="seg ad-seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" class={v === value ? 'on' : ''} aria-pressed={v === value ? 'true' : 'false'} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function FilterChips<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: readonly (readonly [V, string, number?])[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div class="ad-fchips" role="group" aria-label={label}>
      {options.map(([v, l, n]) => (
        <button
          key={v}
          type="button"
          class={`ad-fchip${v === value ? ' on' : ''}`}
          aria-pressed={v === value ? 'true' : 'false'}
          onClick={() => onChange(v)}
        >
          {l}
          {n ? <b>{n}</b> : null}
        </button>
      ))}
    </div>
  );
}

// ---------- Pills and tiles ----------

export function Pill({ label, tone = '', icon }: { label: ComponentChildren; tone?: string; icon?: string }) {
  return (
    <span class={`pill ${tone}`}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {label}
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  tone = '',
  href,
  icon,
}: {
  label: string;
  value: ComponentChildren;
  sub?: ComponentChildren;
  tone?: string;
  href?: string;
  icon?: string;
}) {
  const body = (
    <>
      <div class="row between ad-kpi-h">
        <span class="lbl">{label}</span>
        {icon ? (
          <span class="ad-kpi-ic">
            <Icon name={icon} size={18} />
          </span>
        ) : null}
      </div>
      <div class="num ad-kpi-v">{value}</div>
      {sub ? <div class="xs">{sub}</div> : null}
    </>
  );
  return href ? (
    <a class={`ad-kpi ${tone}`} href={`#/${href}`}>
      {body}
    </a>
  ) : (
    <div class={`ad-kpi ${tone}`}>{body}</div>
  );
}

export function Meter({ value, max, tone = '' }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div class={`bar ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Label / value rows (definition list). */
export function Facts({ rows }: { rows: readonly (readonly [string, ComponentChildren])[] }) {
  return (
    <dl class="ad-facts">
      {rows.map(([k, v]) => (
        <div key={k} class="ad-fact">
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- States ----------

export function Empty({
  icon = 'list',
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: ComponentChildren;
  action?: ComponentChildren;
}) {
  return (
    <div class="ad-empty">
      <span class="ad-empty-ic">
        <Icon name={icon} size={26} />
      </span>
      <div class="h3">{title}</div>
      {body ? <p class="sm">{body}</p> : null}
      {action ? <div class="mt8">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ rows = 5, height = 52 }: { rows?: number; height?: number }) {
  return (
    <div class="stack ad-skel-list" style={{ '--gap': '8px' }} aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} class="ad-skel" style={{ height: `${height}px`, opacity: String(1 - i * 0.12) }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const forbidden = isCode(error, 'forbidden');
  return (
    <div class="ad-error" role="alert">
      <span class="ad-empty-ic err">
        <Icon name={forbidden ? 'lock' : 'alert'} size={24} />
      </span>
      <div class="grow">
        <div class="h3">{forbidden ? 'Sem permissão para ver isto.' : 'Não deu para carregar.'}</div>
        <p class="sm">{errorMessage(error)}</p>
      </div>
      {retry && !forbidden ? <Button label="Tentar de novo" icon="refresh" kind="light" onClick={retry} /> : null}
    </div>
  );
}

/** Loading / error / content in one place. */
export function Async<T>({
  load,
  children,
  rows,
}: {
  load: { data: T | undefined; error: unknown; loading: boolean; reload(): void };
  children: (data: T) => ComponentChildren;
  rows?: number;
}) {
  if (load.error && load.data === undefined) return <ErrorBox error={load.error} retry={load.reload} />;
  if (load.data === undefined) return <Skeleton rows={rows} />;
  return <>{children(load.data)}</>;
}

export function MoreButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <div class="row center mt8">
      <Button label="Carregar mais" kind="light" icon="down" busy={loading} onClick={onClick} />
    </div>
  );
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      label={done ? 'Copiado' : label}
      icon={done ? 'check' : 'copy'}
      kind="light"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          },
          () => setDone(false),
        );
      }}
    />
  );
}

/** A one-time link the panel hands out (invite, password reset). */
export function OneTimeLink({ url, expiresAt, note }: { url: string; expiresAt: number; note: string }) {
  return (
    <div class="card gr stack" style={{ '--gap': '10px' }}>
      <div class="lbl gr">Link gerado</div>
      <code class="ad-code ad-break">{url}</code>
      <div class="row wrapx between">
        <span class="xs">
          {note} Vale até {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(expiresAt)}.
        </span>
        <CopyButton text={url} label="Copiar link" />
      </div>
    </div>
  );
}

export function NoAccess({ what }: { what?: string }) {
  return (
    <Empty
      icon="lock"
      title="Esta área não faz parte do seu papel."
      body={`${what ? `${what}: ` : ''}peça acesso a um admin se precisar dela.`}
      action={<LinkButton href="" label="Voltar ao painel" icon="home" />}
    />
  );
}
