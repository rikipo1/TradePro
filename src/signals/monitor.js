/* [E3-1] Monitoring Engine — system, który sam wie, kiedy przestaje działać.
   Czyste funkcje na dzienniku (wpisy mają prob/ev/riskPct z [A7]).
   Degradacja ⇒ AUTO-REVERT: meta.reliable=false (→ DEFAULT_WEIGHTS, stały
   sizing, kalibracja off) do czasu ponownego treningu. */

const CLOSED = e => e.result && e.result !== 'open' && e.result !== 'pending' && e.result !== 'cancelled';

/* stats z ostatnich `win` zamkniętych transakcji sym×tf */
export function rollingStats(journal, sym, tf, win = 30) {
  const closed = (journal || [])
    .filter(e => CLOSED(e) && (sym == null || e.sym === sym) && (tf == null || e.tf === tf))
    .sort((a, b) => (b.exitTs || b.ts || 0) - (a.exitTs || a.ts || 0))
    .slice(0, win);
  if (!closed.length) return { n: 0, avgR: null, winRate: null, pf: null, brierLive: null };
  const rs = closed.map(e => e.r || 0);
  const sum = rs.reduce((a, b) => a + b, 0);
  const wins = rs.filter(r => r > 0.2).length;
  const losses = rs.filter(r => r < -0.2).length;
  const gW = rs.reduce((a, r) => a + (r > 0 ? r : 0), 0);
  const gL = rs.reduce((a, r) => a + (r < 0 ? -r : 0), 0);
  const withProb = closed.filter(e => e.prob != null);
  const brierLive = withProb.length >= 10
    ? +(withProb.reduce((a, e) => a + Math.pow((e.prob) - ((e.r || 0) > 0 ? 1 : 0), 2), 0) / withProb.length).toFixed(4)
    : null;
  return {
    n: closed.length,
    avgR: +(sum / closed.length).toFixed(3),
    winRate: (wins + losses) ? +(wins / (wins + losses) * 100).toFixed(1) : null,
    pf: gL > 0 ? +(gW / gL).toFixed(2) : (gW > 0 ? 99 : 0),
    brierLive,
    nProb: withProb.length,
  };
}

/* alert gdy live odkleja się od walidacji (przez ≥20 transakcji):
   avgR < p25 z k-fold LUB brier live > max(0.27, brierP75 z k-fold) */
export function degradation(rolling, meta) {
  if (!rolling || rolling.n < 20 || !meta || !meta.agg) return { degraded: false, reasons: [] };
  const reasons = [];
  const p25 = meta.agg.avgR ? meta.agg.avgR.p25 : null;
  if (p25 != null && rolling.avgR != null && rolling.avgR < p25) {
    reasons.push('rolling avgR ' + rolling.avgR + 'R < p25 walidacji (' + p25 + 'R)');
  }
  const brierLimit = Math.max(0.27, (meta.agg.brier && meta.agg.brier.p75 != null) ? meta.agg.brier.p75 : 0);
  if (rolling.brierLive != null && rolling.brierLive > brierLimit) {
    reasons.push('Brier live ' + rolling.brierLive + ' > ' + brierLimit.toFixed(2));
  }
  return { degraded: reasons.length > 0, reasons };
}
