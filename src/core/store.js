/* ============================ [1] STORAGE ============================ */
export const Store = (() => {
  const mem = {};
  let ok = false;
  try { localStorage.setItem('__rt_test','1'); localStorage.removeItem('__rt_test'); ok = true; } catch(e){ ok = false; }
  return {
    persistent: ok,
    get(k, d){
      try{ if(ok){ const v = localStorage.getItem(k); if(v !== null) return JSON.parse(v); } }catch(e){}
      return (k in mem) ? mem[k] : d;
    },
    set(k, v){
      mem[k] = v;
      try{ if(ok) localStorage.setItem(k, JSON.stringify(v)); }catch(e){}
    }
  };
})();
