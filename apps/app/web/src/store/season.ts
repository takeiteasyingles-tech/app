// Season test actions (spec 07, feature B). The test lives on the server (live from D1, no content
// file): the screen loads it with GET /api/seasons/:n/test; answers and the submit go through send()
// like the e-book test, so a pass plays the season_pass award (+100 pontos) and the store learns the
// new result and certificate (TieState.seasonTests / certificates) without a reload.
// Not re-exported from store/index: only the season test screen's chunk carries it.
import { seasonsApi } from '@tie/shared/contracts/seasonTest';
import type { TestAnswer } from '@tie/shared/state';
import { uiConfig } from '@tie/ui';
import { send } from './actions';

/** Saves season test answers (null clears one); `reset` starts a redo. */
export const saveSeasonAnswers = (n: number, answers: Readonly<Record<string, TestAnswer | null>>, reset = false) =>
  send(
    seasonsApi.testAnswers,
    { params: { n }, body: { answers: { ...answers }, ...(reset ? { reset } : {}) } },
    {
      optimistic: reset
        ? (s) => {
            const cur = s.seasonTests[String(n)];
            return cur ? { seasonTests: { ...s.seasonTests, [String(n)]: { ...cur, submittedAt: 0 } } } : undefined;
          }
        : undefined,
    },
  );

/** Grades the test on the server; a pass awards season_pass once and issues the certificate once. */
export const submitSeasonTest = (n: number, answers: Readonly<Record<string, TestAnswer | null>>) =>
  send(
    seasonsApi.testSubmit,
    { params: { n }, body: { answers: { ...answers } } },
    {
      apply: (r, s) => {
        if (!r.passed) uiConfig.sfx('soft');
        const c = r.certificate;
        return {
          seasonTests: {
            ...s.seasonTests,
            [String(n)]: { scorePct: r.scorePct, passed: r.passed, attempts: r.attempts, submittedAt: Date.now() },
          },
          ...(c && !s.certificates.some((x) => x.id === c.id)
            ? {
                certificates: [
                  ...s.certificates,
                  {
                    id: c.id,
                    code: c.code,
                    seasonN: c.seasonN,
                    scorePct: c.scorePct,
                    issuedAt: c.issuedAt,
                    revoked: c.revoked,
                  },
                ],
              }
            : {}),
        };
      },
    },
  );
