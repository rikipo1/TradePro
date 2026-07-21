import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GOLDEN_SERIES, goldenOutputs } from '../scripts/genGolden.js';

/* [E3-6] Golden testy: po refaktorze computeSignal (gates.js/levels.js)
   pełne `out` musi być identyczne 1:1 (reasons bez kolejności). */

const canon = (o) => {
  if (o == null) return o;
  const c = JSON.parse(JSON.stringify(o));
  if (Array.isArray(c.reasons)) c.reasons.sort((a, b) => (a.txt + a.pts).localeCompare(b.txt + b.pts));
  return c;
};

for (const s of GOLDEN_SERIES) {
  test('[E3-6] golden 1:1 — ' + s.name, () => {
    const file = path.join(process.cwd(), 'test', 'golden', 'golden-' + s.name + '.json');
    assert.ok(fs.existsSync(file), 'brak pliku golden — uruchom node scripts/genGolden.js');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const current = goldenOutputs(s);
    assert.deepEqual(Object.keys(current), Object.keys(stored), 'te same indeksy');
    for (const k of Object.keys(stored)) {
      assert.deepEqual(canon(current[k]), canon(stored[k]), 'out identyczne @ i=' + k);
    }
  });
}
