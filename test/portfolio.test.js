import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portfolioCheck, varLite } from '../src/signals/portfolio.js';

const corr = {
  DAX: { DAX: 1, US500: 0.85, EURUSD: 0.1 },
  US500: { DAX: 0.85, US500: 1, EURUSD: 0.1 },
  NAS: { DAX: 0.8, US500: 0.9, NAS: 1 },
  EURUSD: { DAX: 0.1, US500: 0.1, EURUSD: 1 },
};
// dołóż NAS do wierszy
corr.DAX.NAS = 0.8; corr.US500.NAS = 0.9; corr.EURUSD.NAS = 0.05; corr.NAS.EURUSD = 0.05;

test('[E4-1] cap sumaryczny: suma riskPct > 2% ⇒ blokada', () => {
  const r = portfolioCheck({ sym: 'EURUSD', dir: 1, riskPct: 1.0 },
    [{ sym: 'DAX', dir: 1, riskPct: 0.8 }, { sym: 'US500', dir: -1, riskPct: 0.5 }], corr);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /suma ryzyka/);
});

test('[E4-1] jedna skorelowana pozycja (ρ>0.7, ten sam kierunek) ⇒ scale 0.5', () => {
  const r = portfolioCheck({ sym: 'DAX', dir: 1, riskPct: 0.5 },
    [{ sym: 'US500', dir: 1, riskPct: 0.5 }], corr);
  assert.equal(r.allowed, true);
  assert.equal(r.scale, 0.5);
  assert.match(r.reason, /ρ/);
});

test('[E4-1] antykorelacja ρ<−0.7 + przeciwny kierunek = to samo ryzyko ⇒ scale 0.5', () => {
  const c2 = { A: { A: 1, B: -0.8 }, B: { A: -0.8, B: 1 } };
  const r = portfolioCheck({ sym: 'A', dir: 1, riskPct: 0.5 }, [{ sym: 'B', dir: -1, riskPct: 0.5 }], c2);
  assert.equal(r.scale, 0.5);
});

test('[E4-1] dwie skorelowane pozycje ⇒ blokada', () => {
  const r = portfolioCheck({ sym: 'DAX', dir: 1, riskPct: 0.3 },
    [{ sym: 'US500', dir: 1, riskPct: 0.3 }, { sym: 'NAS', dir: 1, riskPct: 0.3 }], corr);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /jedna ekspozycja/);
});

test('[E4-1] VaR-lite na znanych liczbach', () => {
  // jedna pozycja: σ = 1.0%·0.8 ⇒ VaR = 1.65·0.8 = 1.32
  assert.ok(Math.abs(varLite([{ sym: 'X', dir: 1, riskPct: 1.0 }], null) - 1.32) < 1e-9);
  // dwie w pełni skorelowane, ten sam kierunek: σ = 2·0.8 ⇒ 2.64
  const cFull = { X: { X: 1, Y: 1 }, Y: { X: 1, Y: 1 } };
  const v2 = varLite([{ sym: 'X', dir: 1, riskPct: 1 }, { sym: 'Y', dir: 1, riskPct: 1 }], cFull);
  assert.ok(Math.abs(v2 - 2.64) < 1e-9, 'v2=' + v2);
  // przeciwne kierunki przy ρ=1 znoszą się do zera
  const v3 = varLite([{ sym: 'X', dir: 1, riskPct: 1 }, { sym: 'Y', dir: -1, riskPct: 1 }], cFull);
  assert.equal(v3, 0);
});

test('[E4-1] VaR > limitu ⇒ blokada', () => {
  const cFull = { X: { X: 1, Y: 1 }, Y: { X: 1, Y: 1 } };
  // open 2.0% + nowa 1.0%·scale0.5 ⇒ σ=2.5·0.8, VaR=3.3% > 3%
  const r = portfolioCheck({ sym: 'X', dir: 1, riskPct: 1.0 },
    [{ sym: 'Y', dir: 1, riskPct: 2.0 }], cFull, { maxTotalRiskPct: 5 });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /VaR/);
});
