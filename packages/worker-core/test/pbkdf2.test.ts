import { describe, expect, it } from 'vitest';
import { dummyVerify, hashPassword, parseHash, verifyPassword } from '../src/auth/pbkdf2';

describe('pbkdf2', () => {
  it('hashes in the pbkdf2-sha256$100000$salt$hash format', async () => {
    const stored = await hashPassword('senha-boa-123');
    const parts = stored.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2-sha256');
    expect(parts[1]).toBe('100000');
    expect(atob(parts[2] ?? '')).toHaveLength(16);
    expect(atob(parts[3] ?? '')).toHaveLength(32);
    expect(parseHash(stored)?.iterations).toBe(100_000);
  });

  it('round-trips and rejects a wrong password', async () => {
    const stored = await hashPassword('café com leite');
    expect(await verifyPassword('café com leite', stored)).toBe(true);
    expect(await verifyPassword('cafe com leite', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('normalizes unicode (NFC vs NFD é)', async () => {
    const stored = await hashPassword('café');
    expect(await verifyPassword('café', stored)).toBe(true);
  });

  it('treats malformed or missing hashes as a failed verify', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$10$abc')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$100000$!!$!!')).toBe(false);
    expect(parseHash('pbkdf2-sha256$999999$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')).toBeNull();
  });

  it('dummyVerify always fails', async () => {
    expect(await dummyVerify('anything')).toBe(false);
  });
});
