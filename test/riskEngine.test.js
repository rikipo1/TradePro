import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskStatus } from '../src/signals/riskEngine.js';

const now = Date.now();
const closedLoss = (r, ts = now) => ({ result: 'sl', r, exitTs: ts, ts });

test('[A5] floating −2R + zamknięte −1.5R przy limicie 3 ⇒ blocked z „floating" w reason', () => {
  const rs = riskStatus([closedLoss(-1.5)], { maxDailyLossR: 3 }, { floatingR: -2, openCount: 1 });
  assert.equal(rs.blocked, true);
  assert.match(rs.reason, /floating/);
  assert.equal(rs.effDailyR, -3.5);
});

test('[A5] floating +5R NIE odrabia limitu', () => {
  const rs = riskStatus([closedLoss(-3)], { maxDailyLossR: 3 }, { floatingR: 5, openCount: 1 });
  assert.equal(rs.blocked, true, 'zamknięte −3R = limit, zysk papierowy nie pomaga');
  assert.equal(rs.effDailyR, -3);
});

test('[A5] openCount=2 / maxOpen=2 ⇒ blocked', () => {
  const rs = riskStatus([], { maxOpen: 2 }, { floatingR: 0, openCount: 2 });
  assert.equal(rs.blocked, true);
  assert.match(rs.reason, /otwartych pozycji/);
});

test('[A5] strata z exitTs sprzed północy UTC nie wlicza się do dzisiejszego limitu', () => {
  const d = new Date();
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const rs = riskStatus([closedLoss(-5, utcMidnight - 3600 * 1000)], { maxDailyLossR: 3 });
  assert.equal(rs.dailyR, 0);
  assert.equal(rs.blocked, false);
});

test('[A5] wywołanie bez live ⇒ zachowanie wsteczne', () => {
  const rs = riskStatus([closedLoss(-1)], { maxDailyLossR: 3 });
  assert.equal(rs.blocked, false);
  assert.equal(rs.effDailyR, rs.dailyR);
  assert.equal(rs.openCount, null);
});

test('[A5] seria strat z rzędu nadal działa', () => {
  const j = [-1, -1, -1, -1].map((r, i) => closedLoss(r, now - i * 1000));
  const rs = riskStatus(j, { maxDailyLossR: 99, maxConsecLoss: 4 });
  assert.equal(rs.blocked, true);
  assert.match(rs.reason, /seria/);
});
