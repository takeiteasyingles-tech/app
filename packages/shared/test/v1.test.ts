// v1 foundation (spec 07): contracts, permissions, constants and the pure helpers the five features
// build on.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { can, MIN_ROLE } from '../src/authz';
import { CERT_CODE_RE, isOutboxPath, OUTBOX_PATHS } from '../src/constants';
import {
  adminApi,
  adminMcpApi,
  appApi,
  CertCode,
  CreateApiTokenBody,
  EpisodeFeedbackBody,
  listEndpoints,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  SeasonTestQuestionInput,
  SeasonTestQuestionPatch,
  seasonTestQuestionIssues,
} from '../src/contracts/index';
import { feedbackStats } from '../src/domain/feedback';
import { scorePct, seasonEpisodesMissing, seasonTestPassed, seasonTestUnlocked } from '../src/domain/season';
import { apiToken, certificateCode, randomChars } from '../src/ids';
import { freshState, TieState } from '../src/state';

describe('v1 endpoints', () => {
  it('adds the student and admin surface', () => {
    const app = listEndpoints(appApi).map((e) => `${e.method} ${e.path}`);
    for (const p of [
      'POST /api/auth/reset/request',
      'GET /api/seasons/:n/test',
      'PUT /api/seasons/:n/test/answers',
      'POST /api/seasons/:n/test/submit',
      'GET /api/certificates',
      'GET /api/certificates/:id/pdf',
      'GET /api/certificates/verify/:code',
      'PUT /api/feedback/episodes/:n',
    ]) {
      expect(app).toContain(p);
    }
    const admin = listEndpoints(adminApi).map((e) => `${e.method} ${e.path} ${e.perm}`);
    for (const p of [
      'GET /admin-api/content/seasons content.edit',
      'PUT /admin-api/content/seasons/:id content.edit',
      'GET /admin-api/seasons/:n/test content.edit',
      'POST /admin-api/seasons/:n/test/draft content.edit',
      'POST /admin-api/seasons/:n/test/review content.edit',
      'POST /admin-api/seasons/:n/test/publish content.publish',
      'GET /admin-api/certificates users.read',
      'POST /admin-api/certificates/:id/revoke certificates.revoke',
      'GET /admin-api/feedback feedback.read',
      'GET /admin-api/feedback/summary feedback.read',
      'GET /admin-api/users/:id/stats users.read',
      'GET /admin-api/stats/learning users.read',
      'GET /admin-api/api-tokens api_tokens.manage',
      'POST /admin-api/api-tokens api_tokens.manage',
      'DELETE /admin-api/api-tokens/:id api_tokens.manage',
    ]) {
      expect(admin).toContain(p);
    }
    expect(appApi.auth.resetRequest.rateLimit).toBe('RL_AUTH');
    expect(adminApi.seasonTest.draft.rateLimit).toBe('RL_AI');
  });

  it('keeps the MCP endpoint out of the staff tables, Bearer-only', () => {
    expect(adminMcpApi.rpc.access).toBe('agent');
    expect(listEndpoints(adminApi).some((e) => e.path === adminMcpApi.rpc.path)).toBe(false);
  });

  it('maps the new permissions to roles', () => {
    expect(can(['moderator'], 'feedback.read')).toBe(true);
    expect(can(['editor'], 'feedback.read')).toBe(true);
    expect(MIN_ROLE['feedback.read']).toBe('moderator');
    expect(can(['editor'], 'certificates.revoke')).toBe(false);
    expect(can(['moderator'], 'certificates.revoke')).toBe(false);
    expect(can(['admin'], 'certificates.revoke')).toBe(true);
    expect(can(['editor'], 'api_tokens.manage')).toBe(false);
    expect(can(['admin'], 'api_tokens.manage')).toBe(true);
    expect(can(['super_admin'], 'api_tokens.manage')).toBe(true);
  });

  it('queues the season test and NPS writes offline, nothing else new', () => {
    expect(isOutboxPath('/api/seasons/1/test/answers')).toBe(true);
    expect(isOutboxPath('/api/seasons/12/test/submit')).toBe(true);
    expect(isOutboxPath('/api/feedback/episodes/3')).toBe(true);
    expect(isOutboxPath('/api/auth/reset/request')).toBe(false);
    expect(isOutboxPath('/api/certificates')).toBe(false);
    expect(OUTBOX_PATHS.length).toBeGreaterThan(0);
  });
});

describe('v1 schemas', () => {
  it('state carries feedback, season tests and certificates, defaulting for older payloads', () => {
    const s = freshState(0);
    expect(s.feedback).toEqual({});
    expect(TieState.parse(s)).toEqual(s);
    const { feedback: _f, seasonTests: _s, certificates: _c, ...old } = s;
    const parsed = TieState.parse(old);
    expect(parsed.certificates).toEqual([]);
    expect(parsed.seasonTests).toEqual({});
  });

  it('validates the NPS body', () => {
    expect(EpisodeFeedbackBody.parse({ stars: 5, comment: '  ótimo  ' })).toEqual({ stars: 5, comment: 'ótimo' });
    expect(EpisodeFeedbackBody.parse({ stars: 3, comment: '   ' })).toEqual({ stars: 3, comment: null });
    expect(EpisodeFeedbackBody.parse({ stars: 1 })).toEqual({ stars: 1 });
    expect(EpisodeFeedbackBody.safeParse({ stars: 0 }).success).toBe(false);
    expect(EpisodeFeedbackBody.safeParse({ stars: 6 }).success).toBe(false);
    expect(EpisodeFeedbackBody.safeParse({ stars: 4, comment: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('checks season test questions: choice or typed', () => {
    const choice = { q: 'Pick one', opts: ['a', 'b', 'c'], answerIdx: 2 };
    expect(SeasonTestQuestionInput.safeParse(choice).success).toBe(true);
    expect(SeasonTestQuestionInput.safeParse({ q: 'Type it', accept: ['hello'] }).success).toBe(true);
    expect(SeasonTestQuestionInput.safeParse({ ...choice, answerIdx: 3 }).success).toBe(false);
    expect(SeasonTestQuestionInput.safeParse({ q: 'x', opts: ['a', 'b'] }).success).toBe(false);
    expect(SeasonTestQuestionInput.safeParse({ q: 'x' }).success).toBe(false);
    expect(SeasonTestQuestionInput.safeParse({ ...choice, status: 'approved' }).success).toBe(false);
    expect(SeasonTestQuestionPatch.parse({ q: 'New text' })).toEqual({ q: 'New text' });
    expect(seasonTestQuestionIssues({ opts: null, answerIdx: null, accept: ['ok'] })).toEqual([]);
  });

  it('validates API token creation (strict, unique scopes)', () => {
    expect(CreateApiTokenBody.safeParse({ name: 'Claude', scopes: ['content.read'] }).success).toBe(true);
    expect(CreateApiTokenBody.safeParse({ name: 'Claude', scopes: ['content.read', 'content.read'] }).success).toBe(
      false,
    );
    expect(CreateApiTokenBody.safeParse({ name: 'Claude', scopes: ['content.publish'] }).success).toBe(false);
    expect(CreateApiTokenBody.safeParse({ name: 'Claude', scopes: ['content.edit'], x: 1 }).success).toBe(false);
  });
});

describe('MCP tools', () => {
  it('lists the agreed tools, no publish', () => {
    expect(MCP_TOOL_NAMES).toEqual([
      'list_seasons',
      'get_season',
      'update_season',
      'list_episodes',
      'get_episode',
      'update_episode',
      'list_ebooks',
      'get_ebook',
      'update_ebook',
      'list_season_test_questions',
      'draft_season_test_questions',
      'update_season_test_question',
      'preview_release',
    ]);
    expect(MCP_TOOL_NAMES.some((n) => n.includes('publish') && n !== 'preview_release')).toBe(false);
    for (const n of MCP_TOOL_NAMES) {
      const t = MCP_TOOLS[n];
      expect(t.readOnly, n).toBe(t.scope === 'content.read');
    }
  });

  it('turns every tool input into a JSON Schema object (tools/list)', () => {
    for (const n of MCP_TOOL_NAMES) {
      const schema = z.toJSONSchema(MCP_TOOLS[n].input, { io: 'input', unrepresentable: 'any' }) as { type?: string };
      expect(schema.type, n).toBe('object');
    }
  });

  it('keeps agents away from the episode status and number', () => {
    const upd = MCP_TOOLS.update_episode.input;
    expect(upd.safeParse({ num: 1, patch: { synopsis: 'Nova sinopse' } }).success).toBe(true);
    expect(upd.safeParse({ num: 1, patch: { status: 'published' } }).success).toBe(false);
    expect(upd.safeParse({ num: 1, patch: { num: 2 } }).success).toBe(false);
  });
});

describe('v1 helpers', () => {
  it('makes certificate codes and API tokens', () => {
    for (let i = 0; i < 50; i++) expect(certificateCode()).toMatch(CERT_CODE_RE);
    expect(CertCode.parse(' tie-abcd-2345 ')).toBe('TIE-ABCD-2345');
    expect(CertCode.safeParse('TIE-ABC0-2345').success).toBe(false);
    const t = apiToken();
    expect(t).toMatch(/^tie_pat_[A-Za-z0-9_-]{43}$/);
    expect(randomChars('AB', 64)).toMatch(/^[AB]{64}$/);
  });

  it('summarizes star ratings NPS-style', () => {
    expect(feedbackStats([0, 0, 0, 0, 0])).toEqual({ count: 0, avg: null, dist: [0, 0, 0, 0, 0], nps: null });
    // 2 detractors (1★, 2★), 1 passive, 3 promoters → (3 − 2) / 6 = 17; avg 22 / 6 = 3.67.
    expect(feedbackStats([1, 1, 0, 1, 3])).toEqual({ count: 6, avg: 3.67, dist: [1, 1, 0, 1, 3], nps: 17 });
    expect(feedbackStats([0, 0, 0, 0, 4]).nps).toBe(100);
    expect(feedbackStats([2, 0, 0, 0, 0]).nps).toBe(-100);
  });

  it('unlocks the season test when every published episode is done', () => {
    expect(seasonTestUnlocked([], {})).toBe(false);
    expect(seasonTestUnlocked([1, 2], { 1: true })).toBe(false);
    expect(seasonTestUnlocked([1, 2], { 1: true, 2: true, 9: true })).toBe(true);
    expect(seasonEpisodesMissing([3, 1, 2], { 2: true })).toEqual([1, 3]);
    expect(scorePct(14, 20)).toBe(70);
    expect(scorePct(0, 0)).toBe(0);
    expect(seasonTestPassed(70, 70)).toBe(true);
    expect(seasonTestPassed(69, 70)).toBe(false);
  });
});
