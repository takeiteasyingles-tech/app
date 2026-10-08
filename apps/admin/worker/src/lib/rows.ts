// Row → API mappers shared by several route modules.
import { type Plan, ReportResult } from '@tie/shared';
import { bool, fromJson } from '@tie/worker-core';
import type { z } from 'zod';

export interface PlanRowDb {
  id: string;
  slug: string;
  name: string;
  ai_minutes_month: number;
  features: string;
  is_default: number;
  active: number;
  created_at: number;
  updated_at: number;
}

export const PLAN_COLS = 'id, slug, name, ai_minutes_month, features, is_default, active, created_at, updated_at';

export function planFromRow(r: PlanRowDb): Plan {
  const features = fromJson<unknown>(r.features, {});
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    aiMinutesMonth: r.ai_minutes_month,
    features:
      features && typeof features === 'object' && !Array.isArray(features) ? (features as Plan['features']) : {},
    isDefault: bool(r.is_default),
    active: bool(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Stored JSON validated against a schema; anything else (corrupt, legacy) reads as null. */
export function parsedOrNull<S extends z.ZodType>(schema: S, text: string | null | undefined): z.output<S> | null {
  if (text == null || text === '') return null;
  const value = fromJson<unknown>(text, undefined);
  if (value === undefined) return null;
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}

export const reportOrNull = (text: string | null | undefined) => parsedOrNull(ReportResult, text);
