import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { saveModelVersion, listModelVersions, activateModelVersion, getActiveVersion, getModelVersion, MAX_MODEL_VERSIONS } from '../src/core/modelStore.js';

const meta = (n) => ({ n, at: n * 1000, modelV: null });
const payload = (n) => ({ weights: { bias: n }, calib: null, meta: meta(n), knn: null });

test('[E3-5] tworzenie wersji i wskaźnik aktywnej', () => {
  const v1 = saveModelVersion('T1', 'M5', payload(1));
  assert.equal(v1, 1);
  assert.equal(getActiveVersion('T1', 'M5'), 1);
  const v2 = saveModelVersion('T1', 'M5', payload(2));
  assert.equal(v2, 2);
  assert.equal(getActiveVersion('T1', 'M5'), 2);
  assert.equal(listModelVersions('T1', 'M5').length, 2);
});

test('[E3-5] FIFO: max 3 wersje, najstarsza wypada', () => {
  for (let i = 1; i <= 4; i++) saveModelVersion('T2', 'M5', payload(i));
  const list = listModelVersions('T2', 'M5');
  assert.equal(list.length, MAX_MODEL_VERSIONS);
  assert.deepEqual(list.map(x => x.v), [2, 3, 4]);
  assert.equal(getModelVersion('T2', 'M5', 1), null);
});

test('[E3-5] rollback: aktywacja starszej wersji kopiuje payload do kluczy live', () => {
  saveModelVersion('T3', 'M5', payload(1));
  saveModelVersion('T3', 'M5', payload(2));
  assert.equal(activateModelVersion('T3', 'M5', 1), true);
  assert.equal(getActiveVersion('T3', 'M5'), 1);
  assert.deepEqual(Store.get('rt_model_weights', null), { bias: 1 });
  assert.equal(Store.get('rt_model_meta', null).n, 1);
});

test('[E3-5] aktywacja nieistniejącej wersji ⇒ false', () => {
  assert.equal(activateModelVersion('T4', 'M5', 9), false);
});
