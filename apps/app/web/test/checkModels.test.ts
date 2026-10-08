// Deploy-time model check (spec 06 "Model ids are unverified"): the catalog parsing and comparison.
import { DEFAULT_MODELS } from '@tie/shared/constants';
import { describe, expect, it } from 'vitest';
import { catalogNames, missingModels } from '../../scripts/checkModels';

describe('checkModels', () => {
  it('reads names from the wrangler JSON (bare array or {result})', () => {
    const list = [{ id: 'x', name: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, { name: '@cf/openai/whisper' }, 7];
    expect([...catalogNames(list)]).toEqual(['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/whisper']);
    expect([...catalogNames({ result: list })]).toHaveLength(2);
    expect(catalogNames(null).size).toBe(0);
  });

  it('lists the default ids missing from the catalog', () => {
    const ids = Object.values(DEFAULT_MODELS);
    expect(missingModels(new Set(ids), ids)).toEqual([]);
    const partial = new Set(ids.filter((id) => id !== DEFAULT_MODELS.guard));
    expect(missingModels(partial, ids)).toEqual([DEFAULT_MODELS.guard]);
  });
});
