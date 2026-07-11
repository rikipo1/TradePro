/* ---------------- Detektor OKAZJI (broader than pullback) ----------------
   Zbiera „fajne sytuacje", które mogą być dobrym wejściem — nie tylko cofnięcie
   w trendzie, ale też: odwrócenie po zdjęciu płynności (sweep), zmiana
   charakteru (CHOCH) na reteście, retest wybicia (BOS), fade z krańca zakresu
   w konsolidacji oraz reakcja na Order Block. Każda okazja ma kierunek, poziom
   wejścia, pewność, ocenę i stan zbliżania. Działa niezależnie od tego, czy
   jest teraz aktywny sygnał (LONG/SHORT/CZEKAJ). Zwraca posortowaną listę.   */

const grade = (c) => (c >= 70 ? 'A' : c >= 55 ? 'B' : c >= 42 ? 'C' : 'D');
const clamp = (c) => Math.max(0, Math.min(100, Math.round(c)));

export function buildOpportunities(ctx) {
  const { price, atr, smc, nearSup, nearRes, rangeMode, rsi, adx, htfDir,
    signalDir, levels, score, pullback } = ctx;
  if (!smc || !atr || price == null) return [];
  const ms = smc.ms;
  const ops = [];

  const gapAtr = (px) => Math.abs(price - px) / atr;
  const stateFor = (px) => {
    const g = gapAtr(px);
    return g <= 0.3 ? 'in_zone' : g <= 1.2 ? 'approaching' : 'watch';
  };
  const align = (d) => (htfDir === d ? 8 : htfDir === -d ? -10 : 0);

  /* 1) aktywny sygnał — wejście teraz */
  if (signalDir !== 0 && levels) {
    const c = clamp(52 + Math.abs(score) / 2);
    ops.push({
      kind: 'signal-now', dir: signalDir, title: 'Wejście teraz', entry: levels.entry,
      confidence: c, grade: grade(c), state: 'ready',
      note: 'aktywny sygnał confluence ' + (score > 0 ? '+' : '') + score,
      factors: [], confirm: [],
    });
  }

  /* 2) wejście po korekcie (pełny plan pullback) */
  if (pullback && pullback.active && pullback.state !== 'invalidated') {
    ops.push({
      kind: 'pullback', dir: pullback.dir, title: 'Wejście po korekcie', entry: pullback.entry,
      zone: pullback.zone, confidence: pullback.confidence, grade: pullback.grade,
      state: pullback.state === 'below' ? 'watch' : pullback.state,
      note: pullback.overextended ? ('cena przewyciągnięta — ' + pullback.reasons.slice(0, 2).join(', ')) : 'cofnięcie do strefy konfluencji',
      factors: pullback.factors.map((f) => f.label), confirm: pullback.confirm,
      target: pullback.target, rr: pullback.rr,
    });
  }

  /* 3) odwrócenie po zdjęciu płynności (liquidity sweep) */
  if (smc.sweep) {
    const d = smc.sweep.dir, px = smc.sweep.level;
    const c = clamp(60 + (adx != null && adx >= 22 ? 6 : 0) + align(d) + (rangeMode ? 4 : 0));
    ops.push({
      kind: 'reversal', dir: d, title: 'Odwrócenie po zdjęciu płynności', entry: px,
      confidence: c, grade: grade(c), state: stateFor(px), note: smc.sweep.txt,
      factors: ['liquidity sweep'], confirm: ['świeca potwierdzenia ' + (d > 0 ? 'w górę' : 'w dół'), 'RSI zawraca'],
    });
  }

  /* 4) zmiana charakteru (CHOCH) — retest złamanego poziomu */
  if (smc.bc && smc.bc.choch !== 0 && smc.bc.brokeLevel != null) {
    const d = smc.bc.choch, px = smc.bc.brokeLevel;
    const c = clamp(52 + align(d) + (adx != null && adx >= 22 ? 5 : 0));
    ops.push({
      kind: 'choch-retest', dir: d, title: 'Zmiana charakteru (CHOCH) — retest', entry: px,
      confidence: c, grade: grade(c), state: stateFor(px),
      note: 'złamany ' + (d > 0 ? 'swing high' : 'swing low') + ' — czekaj na retest',
      factors: ['CHOCH'], confirm: ['reakcja na reteście'],
    });
  }

  /* 5) retest wybicia (BOS — kontynuacja) */
  if (smc.bc && smc.bc.bos !== 0 && smc.bc.brokeLevel != null) {
    const d = smc.bc.bos, px = smc.bc.brokeLevel;
    const c = clamp(55 + align(d) + (adx != null && adx >= 25 ? 8 : 0));
    ops.push({
      kind: 'breakout-retest', dir: d, title: 'Retest wybicia (BOS)', entry: px,
      confidence: c, grade: grade(c), state: stateFor(px),
      note: 'kontynuacja po wybiciu — wejście na powrocie do złamanego poziomu',
      factors: ['BOS'], confirm: ['odbicie od poziomu'],
    });
  }

  /* 6) fade z krańca zakresu (konsolidacja → powrót do równowagi) */
  if (rangeMode && ms && smc.pd) {
    if (smc.pd.zone === 'premium') {
      const c = clamp(48 + (rsi != null && rsi >= 68 ? 8 : 0));
      ops.push({
        kind: 'range-fade', dir: -1, title: 'Fade z górnego krańca zakresu', entry: price, target: ms.mid,
        confidence: c, grade: grade(c), state: 'in_zone', note: 'konsolidacja — powrót do równowagi 50%',
        factors: ['premium ' + smc.pd.pct + '%'], confirm: ['świeca odwrócenia u góry'],
      });
    } else if (smc.pd.zone === 'discount') {
      const c = clamp(48 + (rsi != null && rsi <= 32 ? 8 : 0));
      ops.push({
        kind: 'range-fade', dir: 1, title: 'Fade z dolnego krańca zakresu', entry: price, target: ms.mid,
        confidence: c, grade: grade(c), state: 'in_zone', note: 'konsolidacja — powrót do równowagi 50%',
        factors: ['discount ' + smc.pd.pct + '%'], confirm: ['świeca odwrócenia u dołu'],
      });
    }
  }

  /* 7) reakcja na Order Block */
  if (smc.ob && !smc.ob.mitigated && (smc.ob.inside || smc.ob.distAtr < 0.4)) {
    const d = smc.ob.dir;
    const c = clamp(50 + align(d) + (smc.ob.inside ? 6 : 0));
    ops.push({
      kind: 'ob-reaction', dir: d, title: 'Reakcja na Order Block', entry: (smc.ob.lo + smc.ob.hi) / 2,
      zone: { lo: smc.ob.lo, hi: smc.ob.hi }, confidence: c, grade: grade(c),
      state: smc.ob.inside ? 'in_zone' : 'approaching',
      note: 'cena w świeżym OB ' + (d > 0 ? 'popytowym' : 'podażowym'),
      factors: ['Order Block'], confirm: ['świeca potwierdzenia w OB'],
    });
  }

  /* dedup po rodzaju+kierunku (zostaw mocniejszą), sortuj po gotowości i pewności */
  const best = {};
  for (const o of ops) {
    const key = o.kind + '|' + o.dir;
    if (!best[key] || best[key].confidence < o.confidence) best[key] = o;
  }
  const uniq = Object.keys(best).map((k) => best[k]);
  const rank = (s) => (s === 'ready' ? 4 : s === 'in_zone' ? 3 : s === 'approaching' ? 2 : 1);
  uniq.sort((a, b) => rank(b.state) - rank(a.state) || b.confidence - a.confidence);
  return uniq.slice(0, 4);
}
