import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES, ERROR_MESSAGES, ERROR_STATUS, ErrorEnvelope, errorEnvelope } from '../src/errors';

describe('errors', () => {
  it('has a status and pt-BR message for every code', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it('builds the {error:{code,message}} envelope', () => {
    const e = new ApiError('gated', 'Ouça a abertura até o fim');
    expect(e.status).toBe(409);
    expect(e.toEnvelope()).toEqual({ error: { code: 'gated', message: 'Ouça a abertura até o fim' } });
    expect(ErrorEnvelope.parse(errorEnvelope('quota_exceeded'))).toEqual({
      error: { code: 'quota_exceeded', message: ERROR_MESSAGES.quota_exceeded },
    });
    expect(errorEnvelope('validation_failed', undefined, [{ path: 'email' }]).error.details).toEqual([
      { path: 'email' },
    ]);
  });
});
