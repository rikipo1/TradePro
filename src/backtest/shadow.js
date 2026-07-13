/* [E3-2] Raport Shadow-vs-Backtest.
   Paper (dziennik) nigdy nie może być systematycznie LEPSZY niż pesymistyczny
   backtest — jeśli jest, to walidacja kłamie albo wykonanie liczy inaczej.
   compareShadow to czysta funkcja: żadnych zapytań, tylko dwie listy. */

export function compareShadow(paperTrades, backtestTrades) {
  const stat = (T, isPaper) => {
    const n = T.length;
    if (!n) return { n: 0, winRate: null, avgR: null, beShare: null, approxShare: null };
    const rs = T.map(t => t.r || 0);
    const wins = rs.filter(r => r > 0.2).length;
    const losses = rs.filter(r => r < -0.2).length;
    const be = isPaper
      ? T.filter(t => t.result === 'be').length
      : T.filter(t => t.out === 'BE').length;
    const approx = isPaper ? T.filter(t => t.trailApprox || t.tickApprox).length : 0;
    return {
      n,
      winRate: (wins + losses) ? +(wins / (wins + losses) * 100).toFixed(1) : null,
      avgR: +(rs.reduce((a, b) => a + b, 0) / n).toFixed(3),
      beShare: +(be / n).toFixed(2),
      approxShare: isPaper ? +(approx / n).toFixed(2) : null,
    };
  };
  const paper = stat(paperTrades || [], true);
  const backtest = stat(backtestTrades || [], false);
  const diffAvgR = (paper.n && backtest.n) ? +(paper.avgR - backtest.avgR).toFixed(3) : null;

  let verdict, why;
  if (paper.n < 10 || backtest.n < 10) {
    verdict = 'ZA MAŁO DANYCH';
    why = 'wspólna próba < 10 transakcji po którejś ze stron — wnioski przedwczesne';
  } else if (diffAvgR <= 0.1) {
    verdict = 'OK';
    why = 'różnica avgR ' + diffAvgR + 'R ≤ 0.1R';
  } else if (paper.approxShare >= 0.5) {
    verdict = 'OK';
    why = 'różnica ' + diffAvgR + 'R wyjaśniona flagami trailApprox/tickApprox ('
      + Math.round(paper.approxShare * 100) + '% wpisów z przybliżonym wykonaniem)';
  } else {
    verdict = 'NIEWYJAŚNIONA';
    why = 'paper LEPSZY od backtestu o ' + diffAvgR + 'R bez wyjaśnienia — nie zwiększaj zaufania do systemu';
  }
  return { paper, backtest, diffAvgR, verdict, why };
}
