// Icons: the student app's set (@tie/ui, generated from the prototype) plus the few the panel needs,
// drawn in the same 24×24, 2.2px round-stroke style so both read as one family.
import { Icon as TieIcon, isIconName } from '@tie/ui/icons';
import type { JSX } from 'preact';

const EXTRA: Record<string, () => JSX.Element> = {
  menu: () => <path d="M4 7h16M4 12h16M4 17h16" />,
  search: () => (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  trash: () => (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  upload: () => (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4.5 15.5V20h15v-4.5" />
    </>
  ),
  image: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4.5 18 5-5 3.5 3.5 2.5-2.5 4 4" />
    </>
  ),
  video: () => (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="m16 10.5 5-3v9l-5-3" />
    </>
  ),
  file: () => (
    <>
      <path d="M6 3.5h8l4.5 4.5v12.5H6z" />
      <path d="M14 3.5V8h4.5M9 13h6M9 16.5h6" />
    </>
  ),
  users: () => (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.4c2.1.8 3.5 2.8 3.5 5.6" />
    </>
  ),
  shield: () => (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5 7.5-9.5V6z" />
      <path d="m8.8 12 2.3 2.3 4.2-4.6" />
    </>
  ),
  chart: () => (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  history: () => (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4.5l3 2" />
    </>
  ),
  settings: () => (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
  copy: () => (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  link: () => (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  up: () => <path d="m6 15 6-6 6 6" />,
  key: () => (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  mail: () => (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  alert: () => (
    <>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
  rocket: () => (
    <>
      <path d="M12 15.5 8.5 12C10 7 13.5 3.8 20 4c.2 6.5-3 10-8 11.5Z" />
      <path d="M8.5 12 5 11.5l2.5-3.5 3.5-.5M12 15.5l.5 3.5 3.5-2.5.5-3.5" />
      <path d="M6.5 15.5c-1.5.5-2.5 2.5-2.5 4.5 2 0 4-1 4.5-2.5" />
    </>
  ),
  layers: () => (
    <>
      <path d="m12 3.5 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  sliders: () => (
    <>
      <path d="M6 4v16M12 4v16M18 4v16" />
      <circle cx="6" cy="9" r="2" fill="#fff" />
      <circle cx="12" cy="15" r="2" fill="#fff" />
      <circle cx="18" cy="8" r="2" fill="#fff" />
    </>
  ),
  dots: () => (
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" />
    </>
  ),
  dup: () => (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M14.5 12v5M12 14.5h5M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  refresh: () => (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9" />
      <path d="M19.5 4v5h-5" />
    </>
  ),
};

export type AdminIconName = string;

/** TIE.icon for the panel: the student set first, then the admin extras. */
export function Icon({ name, size = 22, label }: { name: AdminIconName; size?: number; label?: string }) {
  if (isIconName(name) || !EXTRA[name]) {
    return <TieIcon name={name} size={size} extra={label ? { 'aria-hidden': 'false', role: 'img', 'aria-label': label } : undefined} />;
  }
  const draw = EXTRA[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={label ? 'false' : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {draw()}
    </svg>
  );
}
