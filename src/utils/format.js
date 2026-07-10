export function fmtPrice(p, dec){
  if(p == null || !isFinite(p)) return '—';
  const d = (dec != null) ? dec : (Math.abs(p) >= 10 ? 2 : 4);
  return p.toFixed(d);
}
export function fmtPct(v){
  if(v == null || !isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
export function fmtVol(v){
  if(!v) return '0';
  if(v >= 1e9) return (v/1e9).toFixed(2) + 'B';
  if(v >= 1e6) return (v/1e6).toFixed(2) + 'M';
  if(v >= 1e3) return (v/1e3).toFixed(1) + 'k';
  return String(Math.round(v));
}
export function pad2(n){ return n < 10 ? '0'+n : ''+n; }
export function fmtTime(t, tfId){
  const d = new Date(t*1000);
  if(tfId === 'D1') return pad2(d.getDate()) + '.' + pad2(d.getMonth()+1);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
export function fmtFull(t, tfId){
  const d = new Date(t*1000);
  const date = pad2(d.getDate()) + '.' + pad2(d.getMonth()+1) + '.' + d.getFullYear();
  if(tfId === 'D1') return date;
  return date + '  ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
export function fmtClock(dt){
  return pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()) + ':' + pad2(dt.getSeconds());
}
export function niceStep(range, ticks){
  const raw = range / Math.max(1, ticks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const s = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return s * mag;
}

/* ================= [4] SILNIK WYKRESU (canvas, dotyk) ================ */
export const CLR = {
  bg:'#051b21', grid:'rgba(159,226,214,.07)', axis:'#5f8480',
  up:'#2fd6ae', down:'#ff6b5e', txt:'#eef7f4', cross:'rgba(238,247,244,.45)',
};
export const COUNT0 = 90;

export function clampEnd(end, count, len){
  if(len <= 0) return end;
  const maxE = len - 1 + count * 0.15;
  const minE = Math.min(len - 1, Math.max(5, count * 0.4));
  return Math.max(minE, Math.min(maxE, end));
}
