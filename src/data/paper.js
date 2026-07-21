import { coachReview } from '../smc/index.js';

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

export function resolvePaperList(list, sym, px, notify, opts){
  let changed = false;
  const out = list.map(e => {
    if(!e.paper || e.sym !== sym || !e.risk) return e;
    const d = e.dir;

    /* ---- zlecenie oczekujące: aktywacja / anulowanie ---- */
    if(e.result === 'pending'){
      /* [FIX] aktywacja/unieważnienie po EKSTREMACH świec od złożenia zlecenia
         (knot dotykający entry/SL między odczytami był wcześniej pomijany —
         „wejścia nie zawsze łapały"). Świece brane od e.ts (60 s zapasu). */
      let pLo = null, pHi = null;
      if(opts && opts.bars && opts.bars.length){
        for(let q = opts.bars.length - 1; q >= 0; q--){
          const b = opts.bars[q];
          if(b.t * 1000 < e.ts - 60000) break;
          if(pLo == null || b.l < pLo) pLo = b.l;
          if(pHi == null || b.h > pHi) pHi = b.h;
        }
      }
      const lowPx  = pLo != null ? Math.min(px, pLo) : px;
      const highPx = pHi != null ? Math.max(px, pHi) : px;
      const touched = d === 1 ? lowPx <= e.entry : highPx >= e.entry;
      const invalidated = d === 1 ? lowPx <= e.sl : highPx >= e.sl;
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

    /* ---- otwarta pozycja: zarządzanie etapami ---- */
    const stage = e.stage || 'open';
    const slCur = e.slDyn != null ? e.slDyn : e.sl;
    const rOf = (p) => ((p - e.entry) / e.risk) * d;
    /* [FIX] SL/TP względem EKSTREMÓW świec OD WEJŚCIA, nie tylko próbkowanej
       ceny — inaczej knot dotykający SL między odczytami (co 15 s) był
       pomijany i pozycja wisiała otwarta zamiast zamknąć się na −1R.
       worstPx = najgorsza cena dla pozycji, bestPx = najlepsza (pesymizm:
       SL sprawdzany PRZED TP). Świece brane od e.ts (z 60 s zapasem). */
    let barLo = null, barHi = null;
    if(opts && opts.bars && opts.bars.length){
      for(let q = opts.bars.length - 1; q >= 0; q--){
        const b = opts.bars[q];
        if(b.t * 1000 < e.ts - 60000) break;
        if(barLo == null || b.l < barLo) barLo = b.l;
        if(barHi == null || b.h > barHi) barHi = b.h;
      }
    }
    const worstPx = d === 1 ? (barLo != null ? Math.min(px, barLo) : px) : (barHi != null ? Math.max(px, barHi) : px);
    const bestPx  = d === 1 ? (barHi != null ? Math.max(px, barHi) : px) : (barLo != null ? Math.min(px, barLo) : px);
    const stopHit = d === 1 ? worstPx <= slCur : worstPx >= slCur;
    /* [A7] koszt transakcyjny w R: jawny costR albo spread/risk — bez tego
       dziennik paper był systematycznie LEPSZY od pesymistycznego backtestu */
    const costR = e.costR != null ? e.costR : (e.risk > 0 && e.spreadPx != null ? e.spreadPx / e.risk : 0);

    if(stopHit){
      changed = true;
      let res, r;
      if(stage === 'open'){ res = 'sl'; r = +(-1 - costR).toFixed(2); }
      else if(stage === 'be'){ res = 'be'; r = +(rOf(slCur) - costR).toFixed(2); }
      else { res = 'tp1'; r = +((e.banked || 0) + 0.5 * rOf(slCur) - costR).toFixed(2); }
      const done = { ...e, result:res, r, exit:slCur, exitTs:Date.now() };
      try{ done.coach = coachReview(done, list); }catch(err){}
      if(notify) notify(done);
      return done;
    }

    let ne = e, mut = false;
    const bump = () => { if(!mut){ ne = { ...e }; mut = true; } };

    if(stage === 'open' && rOf(bestPx) >= 1){               // +1R (intra-świeca) → stop na BE
      bump(); ne.stage = 'be'; ne.slDyn = e.entry;
    }
    const st2 = ne.stage || 'open';
    if((st2 === 'open' || st2 === 'be') && (d === 1 ? bestPx >= e.tp1 : bestPx <= e.tp1)){
      bump();                                                 // TP1 → partial 50%
      ne.stage = 'runner';
      ne.banked = +(0.5 * (e.rr1 || 1.5)).toFixed(2);
      ne.slDyn = d === 1 ? Math.max(ne.slDyn != null ? ne.slDyn : e.sl, e.entry)
                         : Math.min(ne.slDyn != null ? ne.slDyn : e.sl, e.entry);
      ne.partialTs = Date.now();
    }
    if((ne.stage || stage) === 'runner'){
      if(e.tp2 != null && (d === 1 ? bestPx >= e.tp2 : bestPx <= e.tp2)){  // TP2 (intra-świeca) → koniec
        changed = true;
        const r = +(((ne.banked != null ? ne.banked : e.banked) || 0) + 0.5 * rOf(e.tp2) - costR).toFixed(2);
        const done = { ...(mut ? ne : e), result:'tp2', r, exit:e.tp2, exitTs:Date.now() };
        try{ done.coach = coachReview(done, list); }catch(err){}
        if(notify) notify(done);
        return done;
      }
      /* [E3-4/C4] trailing STRUKTURALNY jak w backteście (8-świecowy dołek/
         szczyt ± 0.25·ATR), gdy monitor dostarczy świece; inaczej 1R za ceną
         + flaga trailApprox (rozjazd paper↔backtest widoczny w raporcie E3-2) */
      const cur = ne.slDyn != null ? ne.slDyn : (e.slDyn != null ? e.slDyn : e.sl);
      let trail, structural = false;
      if(opts && opts.atr != null && (d === 1 ? opts.trailLow != null : opts.trailHigh != null)){
        trail = d === 1 ? opts.trailLow - opts.atr * 0.25 : opts.trailHigh + opts.atr * 0.25;
        structural = true;
      } else {
        trail = d === 1 ? px - e.risk : px + e.risk;
      }
      if(d === 1 ? trail > cur : trail < cur){ bump(); ne.slDyn = trail; }
      if(!!e.trailApprox !== !structural){ bump(); ne.trailApprox = !structural; }
    }
    if(mut){ changed = true; return ne; }
    return e;
  });
  return changed ? out : null;
}
