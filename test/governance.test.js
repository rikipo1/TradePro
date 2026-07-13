import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextModelStage, CONFIRM_GAP_MS } from '../src/core/governance.js';

const H25 = 25 * 3600 * 1000;

test('[E2-3] sekwencja T/T (≥24 h) ⇒ candidate → active', () => {
  const t0 = 1000000;
  const s1 = nextModelStage(null, true, t0);
  assert.equal(s1.stage, 'candidate');
  assert.equal(s1.streak, 1);
  const s2 = nextModelStage({ stage: s1.stage, candidateAt: s1.candidateAt, reliableStreak: s1.streak }, true, t0 + H25);
  assert.equal(s2.stage, 'active');
  assert.equal(s2.streak, 2);
});

test('[E2-3] sekwencja T/F/T ⇒ reset i nowa kandydatura', () => {
  const t0 = 1000000;
  const s1 = nextModelStage(null, true, t0);
  const s2 = nextModelStage({ stage: s1.stage, candidateAt: s1.candidateAt }, false, t0 + H25);
  assert.equal(s2.stage, 'off');
  assert.equal(s2.streak, 0);
  const s3 = nextModelStage({ stage: s2.stage, candidateAt: s2.candidateAt }, true, t0 + 2 * H25);
  assert.equal(s3.stage, 'candidate');
  assert.equal(s3.streak, 1);
});

test('[E2-3] sekwencja T / T(za wcześnie) ⇒ nadal kandydat; potem aktywacja', () => {
  const t0 = 1000000;
  const s1 = nextModelStage(null, true, t0);
  const early = nextModelStage({ stage: s1.stage, candidateAt: s1.candidateAt }, true, t0 + CONFIRM_GAP_MS - 1000);
  assert.equal(early.stage, 'candidate');
  assert.equal(early.candidateAt, s1.candidateAt, 'okno liczone od pierwszego potwierdzenia');
  const late = nextModelStage({ stage: early.stage, candidateAt: early.candidateAt }, true, t0 + CONFIRM_GAP_MS + 1000);
  assert.equal(late.stage, 'active');
});

test('[E2-3] active + kolejny T podtrzymuje; active + F wyłącza', () => {
  const meta = { stage: 'active', candidateAt: 5, reliableStreak: 2 };
  assert.equal(nextModelStage(meta, true, 10).stage, 'active');
  assert.equal(nextModelStage(meta, false, 10).stage, 'off');
});
