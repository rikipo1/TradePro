import { coachReview } from '../smc/index.js';

/* --- Paper trading: wirtualne pozycje rozliczane po żywej cenie --- */
export function paperFloating(e, px){
  if(px == null || !e || !e.risk) return null;
  return +(((px - e.entry) / e.risk) * e.dir).toFixed(2);
}
export function resolvePaperList(list, sym, px, notify){
  let changed = false;
  const out = list.map(e => {
    if(!(e.paper && e.result === 'open' && e.sym === sym && e.risk)) return e;
    let res = null, r = 0, lvl = null;
    if(e.dir === 1){
      if(px <= e.sl){ res = 'sl'; r = -1; lvl = e.sl; }
      else if(e.tp2 != null && px >= e.tp2){ res = 'tp2'; r = 2.5; lvl = e.tp2; }
      else if(px >= e.tp1){ res = 'tp1'; r = (e.rr1 || 1.5); lvl = e.tp1; }
    } else {
      if(px >= e.sl){ res = 'sl'; r = -1; lvl = e.sl; }
      else if(e.tp2 != null && px <= e.tp2){ res = 'tp2'; r = 2.5; lvl = e.tp2; }
      else if(px <= e.tp1){ res = 'tp1'; r = (e.rr1 || 1.5); lvl = e.tp1; }
    }
    if(!res) return e;
    changed = true;
    const done = { ...e, result:res, r, exit:lvl, exitTs:Date.now() };
    try{ done.coach = coachReview(done, list); }catch(err){}
    if(notify) notify(done);
    return done;
  });
  return changed ? out : null;
}
