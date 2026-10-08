// Field errors keyed by dotted path ("lyrics.3.en"), from the shared Zod schemas (checked in the
// browser before a save) or from the Worker's validation_failed issues (same path format).
import type { z } from 'zod';
import type { Issue } from '../api';

export type Errors = Readonly<Record<string, string>>;

type ZIssue = z.core.$ZodIssue;

/** pt-BR copy for Zod's issue codes (the Worker's own messages are already in Portuguese). */
export function ptMessage(i: ZIssue): string {
  const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : (v as number));
  switch (i.code) {
    case 'invalid_type': {
      const msg = i.message ?? '';
      if (/received (undefined|null)/.test(msg)) return 'Obrigatório.';
      if (i.expected === 'number' || i.expected === 'int') return 'Use um número.';
      return 'Valor inválido.';
    }
    case 'too_small': {
      const min = n(i.minimum);
      if (i.origin === 'string') return min <= 1 ? 'Obrigatório.' : `Pelo menos ${min} caracteres.`;
      if (i.origin === 'array' || i.origin === 'set')
        return min === 1 ? 'Inclua pelo menos 1 item.' : `Inclua pelo menos ${min} itens.`;
      return `O mínimo é ${min}.`;
    }
    case 'too_big': {
      const max = n(i.maximum);
      if (i.origin === 'string') return `No máximo ${max} caracteres.`;
      if (i.origin === 'array' || i.origin === 'set') return `No máximo ${max} itens.`;
      return `O máximo é ${max}.`;
    }
    case 'invalid_format':
      return i.format === 'email' ? 'E-mail inválido.' : 'Formato inválido.';
    case 'invalid_value':
      return 'Escolha uma das opções.';
    case 'unrecognized_keys':
      return `Campos não aceitos: ${i.keys.join(', ')}.`;
    case 'not_multiple_of':
      return 'Valor fora do passo permitido.';
    case 'invalid_union':
      return 'Valor inválido.';
    default:
      return i.message || 'Valor inválido.';
  }
}

/** Runs a schema in the browser; {} when the value is valid. */
export function zodErrors(schema: z.ZodType, value: unknown): Record<string, string> {
  const r = schema.safeParse(value);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) {
    const key = i.path.map(String).join('.');
    if (!(key in out)) out[key] = ptMessage(i);
  }
  return out;
}

export function issuesToErrors(issues: readonly Issue[], prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = prefix && i.path ? `${prefix}.${i.path}` : prefix || i.path;
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

export const errorCount = (e: Errors): number => Object.keys(e).length;

/** Errors under `prefix` (the item and its fields), as a stable string for memo checks. */
export function errorKey(e: Errors, prefix: string): string {
  let s = '';
  for (const k in e) if (k === prefix || k.startsWith(`${prefix}.`)) s += `${k}\u0001${e[k]}\u0002`;
  return s;
}

/** Re-keys errors of a child entity (e.g. an exercise item) under a path prefix. */
export function prefixErrors(e: Errors, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e)) out[k ? `${prefix}.${k}` : prefix] = v;
  return out;
}
