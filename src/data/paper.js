import { coachReview } from '../smc/index.js';
import { stepPositionTick } from '../signals/tradeManager.js';

/* --- Paper trading: wirtualne pozycje rozliczane po żywej cenie ---
   Zarządzanie pozycją jak w backteście (ten sam schemat):
     open → (po +1R) BE → (na TP1) partial 50% + runner → trailing 1R do TP2.
   Dodatkowo zlecenia OCZEKUJĄCE (result:'pending') — limit w strefę wejścia:
   aktywują się, gdy cena dojdzie do entry; kasują się po unieważnieniu
   (cena za SL zanim dotknęła entry) albo po wygaśnięciu (pendingUntil).   */

export function paperFloating(e, px){
  if(px == null || !e || !e.risk) return null;
  const base = ((px - e.entry) / e.risk) * e.dir;
  if(e.stage === 'runner') return +(((e.banked || 0) + 0.5 * base)).toFixed(2);
  return +base.toFixed(2);
}

export function resolvePaperList(list, sym, px, notify){
  let changed = false;
  const out = list.map(e => {
    if(!e.paper || e.sym !== sym || !e.risk) return e;
    const d = e.dir;

    /* ---- zlecenie oczekujące: aktywacja / anulowanie ---- */
    if(e.result === 'pending'){
      const touched = d === 1 ? px <= e.entry : px >= e.entry;
      const invalidated = d === 1 ? px <= e.sl : px >= e.sl;
      const expired = e.pendingUntil && Date.now() > e.pendingUntil;
      if(invalidated || expired){
        changed = true;
        const done = { ...e, result:'cancelled', r:0, exitTs:Date.now(),
          note: ((e.note || '') + (invalidated ? ' · anulowane: struktura unieważniona' : ' · anulowane: wygasło')).trim() };
        if(notify) notify(done);
        return done;
      }
      if(touched){
        changed = true;
        const act = { ...e, result:'open', ts:Date.now(), stage:'open', banked:0,
          note: ((e.note || '') + ' · LIMIT aktywowany @ ' + e.entry).trim() };
        if(notify) notify(act);
        return act;
      }
      return e;
    }

    if(e.result !== 'open') return e;

    /* ---- otwarta pozycja: zarządzanie przez WSPÓLNY moduł tradeManager [W1] ----
       Paper pracuje na tiku 15 s (px ≈ close), więc używamy stepPositionTick,
       który degraduje do modelu „tik jako close" i — bez świec w monitorze —
       trailinguje 1R za ceną (przybliżenie, flaga trailApprox). Backtest jest
       pesymistyczny (realny intrabar SL-first + trailing strukturalny). */
    const prevStage = e.stage || 'open';
    const prevSl = e.slDyn != null ? e.slDyn : e.sl;
    const st = {
      dir: d, entry: e.entry, sl: e.sl, tp1: e.tp1, tp2: e.tp2,
      risk: e.risk, rr1: e.rr1 || 1.5, costR: 0,
      stage: prevStage, slCur: prevSl, banked: e.banked || 0, sawTp2: !!e.sawTp2,
    };
    const { state, closed, trailApprox } = stepPositionTick(st, px);

    if(closed){
      changed = true;
      const resMap = { SL:'sl', BE:'be', TP1: closed.tp2 ? 'tp2' : 'tp1', TIMEOUT:'timeout' };
      const done = { ...e, result: resMap[closed.out] || closed.out.toLowerCase(),
        r: +closed.r.toFixed(2), exit: closed.exit, exitTs: Date.now(),
        stage: state.stage, slDyn: state.slCur, banked: state.banked };
      if(trailApprox) done.trailApprox = true;
      try{ done.coach = coachReview(done, list); }catch(err){}
      if(notify) notify(done);
      return done;
    }

    /* nadal otwarta: przenieś zmiany etapu/SL (BE, partial, trailing) */
    if(state.stage !== prevStage || state.slCur !== prevSl || (state.banked || 0) !== (e.banked || 0)){
      changed = true;
      const ne = { ...e, stage: state.stage, slDyn: state.slCur, banked: state.banked };
      if(state.stage === 'runner' && prevStage !== 'runner') ne.partialTs = Date.now();
      if(trailApprox) ne.trailApprox = true;
      return ne;
    }
    return e;
  });
  return changed ? out : null;
}
