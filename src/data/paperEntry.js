/* [E4-4] Decision Journal — budowa wpisu paper PRZED transakcją.
   Czysta funkcja (testowalna): komplet pól decyzyjnych zapisany w chwili
   wejścia: poziomy, prob, ev, evModel, regime, riskPct, modelV, sesja,
   snapshot 6 czynników, entryQuality, spreadPx. PO transakcji dochodzą:
   r, result/out, coach, trailApprox/tickApprox. */

export function buildPaperEntry({ sym, name, tfId, dir, entry, sl, tp1, tp2, srcTag, score, eq, sig, modelV }) {
  const risk = Math.abs(entry - sl);
  return {
    id: Date.now(), ts: Date.now(), sym, name, tf: tfId,
    dir, entry, sl, tp1, tp2, risk,
    rr1: +(Math.abs(tp1 - entry) / Math.max(risk, 1e-9)).toFixed(2),
    result: 'open', r: 0, paper: true,
    src: (srcTag || 'manual'), score: (score != null ? score : null),
    entryQuality: eq || null,
    riskPct: sig && sig.sizing ? sig.sizing.riskPct : null,
    note: undefined, // wypełnia portfolioCheck (tryOpenPaper) [E4-1]
    modelV: modelV != null ? modelV : null,                       // [E3-5]
    /* [A7] koszt + metadane pod monitoring i Shadow-vs-Backtest */
    spreadPx: sig && sig.levels ? sig.levels.spreadPx : null,
    prob: sig ? sig.prob : null,
    ev: sig ? sig.ev : null,
    evModel: sig ? sig.evModel : null,
    regime: sig && sig.regime ? sig.regime.type : null,
    session: sig && sig.session ? sig.session.label : null,       // [E4-4]
    factors: sig && sig.factors ? { ...sig.factors } : null,      // [E4-4]
  };
}
