import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionInfo, macroWindow, tzClock } from '../src/utils/sessions.js';

/* Poniedziałki: 2026-07-06 (lato/DST) i 2026-01-05 (zima). */

test('[A6] DAX: lato 07:05 UTC ⇒ okno otwarcia (Berlin 09:05 CEST)', () => {
  assert.equal(macroWindow(new Date('2026-07-06T07:05:00Z')), 'otwarcie DAX 09:00');
});

test('[A6] DAX: lato 08:05 UTC ⇒ null (Berlin 10:05 — stary kod błędnie flagował)', () => {
  assert.equal(macroWindow(new Date('2026-07-06T08:05:00Z')), null);
});

test('[A6] DAX: zima 08:05 UTC ⇒ okno (Berlin 09:05 CET)', () => {
  assert.equal(macroWindow(new Date('2026-01-05T08:05:00Z')), 'otwarcie DAX 09:00');
});

test('[A6] USA: lato 12:30 UTC i zima 13:30 UTC ⇒ „publikacje USA 14:30" (08:30 NY)', () => {
  assert.equal(macroWindow(new Date('2026-07-06T12:30:00Z')), 'publikacje USA 14:30');
  assert.equal(macroWindow(new Date('2026-01-05T13:30:00Z')), 'publikacje USA 14:30');
});

test('[A6] London open 08:15 czasu Londynu = sesja londyńska w OBU porach roku', () => {
  // lato: 08:15 BST = 07:15 UTC; zima: 08:15 GMT = 08:15 UTC
  assert.equal(sessionInfo(new Date('2026-07-06T07:15:00Z')).label, 'sesja londyńska');
  assert.equal(sessionInfo(new Date('2026-01-05T08:15:00Z')).label, 'sesja londyńska');
});

test('[A6] overlap London×NY: lato 14:00 UTC (15:00 London, 10:00 NY)', () => {
  const s = sessionInfo(new Date('2026-07-06T14:00:00Z'));
  assert.equal(s.overlap, true);
  assert.equal(s.quality, 2);
});

test('[A6] weekend wg dnia NY', () => {
  const s = sessionInfo(new Date('2026-07-04T12:00:00Z')); // sobota
  assert.equal(s.weekend, true);
  assert.equal(s.quality, -2);
});

test('[A6] tzClock: h23 i dzień tygodnia', () => {
  const c = tzClock(new Date('2026-07-06T07:05:00Z'), 'Europe/Berlin');
  assert.equal(c.hm, 9 * 60 + 5);
  assert.equal(c.day, 1); // poniedziałek
});
