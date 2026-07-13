import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitStage, WAIT_STAGES } from '../src/signals/waitStage.js';

const base = { dir: 0, score: 0, warns: [], pillars: { bull: 0, bear: 0 }, htfDir: 0 };

test('[WAIT] aktywny sygnał lub stale ⇒ null', () => {
  assert.equal(waitStage({ ...base, dir: 1 }), null);
  assert.equal(waitStage({ ...base, stale: true }), null);
  assert.equal(waitStage(null), null);
});

test('[WAIT] lean ze score, potem z filarów, potem z HTF', () => {
  assert.equal(waitStage({ ...base, score: 20 }).lean, 1);
  assert.equal(waitStage({ ...base, score: -20 }).lean, -1);
  assert.equal(waitStage({ ...base, pillars: { bull: 2, bear: 0 } }).lean, 1);
  assert.equal(waitStage({ ...base, pillars: { bull: 0, bear: 1 } }).lean, -1);
  assert.equal(waitStage({ ...base, htfDir: -1 }).lean, -1);
});

test('[WAIT] etapy lejka rozpoznawane z flag i ostrzeżeń', () => {
  assert.equal(waitStage({ ...base, sessionBlock: true }).stage, 6);
  assert.equal(waitStage({ ...base, evBlock: true }).stage, 5);
  assert.equal(waitStage({ ...base, rrBlock: true }).stage, 4);
  assert.equal(waitStage({ ...base, warns: ['Sygnał przeciw wyższemu interwałowi przy niskim P(win) — odrzucony'] }).stage, 3);
  assert.equal(waitStage({ ...base, warns: ['Za mało zgodnych filarów (struktura/momentum/lokalizacja) — LONG odrzucony'] }).stage, 2);
  assert.equal(waitStage(base).stage, 1);
  assert.equal(WAIT_STAGES, 6);
});

test('[WAIT] priorytet: sessionBlock wygrywa z evBlock (najdalszy etap)', () => {
  const s = waitStage({ ...base, sessionBlock: true, evBlock: true });
  assert.equal(s.stage, 6);
});
