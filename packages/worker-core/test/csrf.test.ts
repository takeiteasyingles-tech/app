import { describe, expect, it } from 'vitest';
import { type CsrfInput, csrfDecision } from '../src/csrf';

const APP = 'https://tie-app.example.workers.dev';

function input(over: Partial<CsrfInput> = {}): CsrfInput {
  return {
    method: 'POST',
    url: `${APP}/api/progress/step-ok`,
    origin: APP,
    secFetchSite: 'same-origin',
    contentType: 'application/json',
    contentLength: '12',
    appOrigin: APP,
    ...over,
  };
}

describe('csrfDecision', () => {
  it('lets safe methods through without checks', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(csrfDecision(input({ method, origin: null, contentType: 'text/plain' }))).toEqual({ ok: true });
    }
  });

  it('accepts a same-origin JSON POST', () => {
    expect(csrfDecision(input())).toEqual({ ok: true });
    expect(csrfDecision(input({ contentType: 'application/json; charset=utf-8' }))).toEqual({ ok: true });
    expect(csrfDecision(input({ secFetchSite: null }))).toEqual({ ok: true });
  });

  it('accepts the request origin when APP_ORIGIN differs (localhost dev)', () => {
    const url = 'http://localhost:8787/api/me/settings';
    expect(csrfDecision(input({ url, origin: 'http://localhost:8787', method: 'PATCH' }))).toEqual({ ok: true });
  });

  it('requires an Origin header', () => {
    expect(csrfDecision(input({ origin: null }))).toEqual({ ok: false, reason: 'missing-origin' });
    expect(csrfDecision(input({ origin: 'null' }))).toEqual({ ok: false, reason: 'missing-origin' });
  });

  it('rejects foreign origins', () => {
    expect(csrfDecision(input({ origin: 'https://evil.example' }))).toEqual({ ok: false, reason: 'bad-origin' });
    expect(csrfDecision(input({ origin: `${APP}.evil.example` }))).toEqual({ ok: false, reason: 'bad-origin' });
    expect(csrfDecision(input({ origin: 'http://tie-app.example.workers.dev' }))).toEqual({
      ok: false,
      reason: 'bad-origin',
    });
    expect(csrfDecision(input({ origin: 'not a url' }))).toEqual({ ok: false, reason: 'bad-origin' });
  });

  it('rejects Sec-Fetch-Site other than same-origin', () => {
    for (const site of ['same-site', 'cross-site', 'none']) {
      expect(csrfDecision(input({ secFetchSite: site }))).toEqual({ ok: false, reason: 'cross-site' });
    }
  });

  it('requires JSON bodies; form encodings are refused', () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      expect(csrfDecision(input({ contentType: ct }))).toEqual({ ok: false, reason: 'content-type' });
    }
  });

  it('allows multipart only on multipart routes', () => {
    const ct = 'multipart/form-data; boundary=----abc';
    expect(csrfDecision(input({ contentType: ct, multipart: true }))).toEqual({ ok: true });
    expect(csrfDecision(input({ contentType: ct, multipart: false })).ok).toBe(false);
  });

  it('allows body-less writes without Content-Type', () => {
    expect(csrfDecision(input({ method: 'DELETE', contentType: null, contentLength: null }))).toEqual({ ok: true });
    expect(csrfDecision(input({ contentType: null, contentLength: '0' }))).toEqual({ ok: true });
    expect(csrfDecision(input({ contentType: null, contentLength: '10' }))).toEqual({
      ok: false,
      reason: 'content-type',
    });
  });
});
