import { DURATIONS } from '@tie/shared';
import { describe, expect, it } from 'vitest';
import { signMediaToken, verifyMediaToken } from '../src/auth/mediaToken';

const KEY = 'test-media-key-0123456789';
const T0 = 1_790_000_000_000;

describe('media token', () => {
  it('signs and verifies for 12h', async () => {
    const { token, expiresAt } = await signMediaToken(KEY, '01JABCDEF', T0);
    expect(expiresAt).toBe(T0 + DURATIONS.mediaTokenMs);
    expect(token.length).toBeLessThan(100);
    expect(await verifyMediaToken(KEY, token, T0 + 1000)).toEqual({ userId: '01JABCDEF', expiresAt });
  });

  it('expires', async () => {
    const { token, expiresAt } = await signMediaToken(KEY, 'U1', T0);
    expect(await verifyMediaToken(KEY, token, expiresAt - 1)).not.toBeNull();
    expect(await verifyMediaToken(KEY, token, expiresAt)).toBeNull();
  });

  it('rejects a wrong key, tampering and junk', async () => {
    const { token } = await signMediaToken(KEY, 'U1', T0);
    expect(await verifyMediaToken('other-key', token, T0)).toBeNull();
    const [exp, , sig] = token.split('.');
    expect(await verifyMediaToken(KEY, `${exp}.U2.${sig}`, T0)).toBeNull();
    const later = (Number.parseInt(exp ?? '0', 36) + 1).toString(36);
    expect(await verifyMediaToken(KEY, `${later}.U1.${sig}`, T0)).toBeNull();
    expect(await verifyMediaToken(KEY, `${token}x`, T0)).toBeNull();
    for (const junk of [undefined, '', 'a.b', 'a.b.c.d', '!!.U1.sig', `${exp}.U1.@@@`]) {
      expect(await verifyMediaToken(KEY, junk, T0)).toBeNull();
    }
  });

  it('refuses user ids that could break the format', async () => {
    await expect(signMediaToken(KEY, 'a.b', T0)).rejects.toThrow();
  });
});
