import React, { useEffect, useRef } from 'react';

export function EquityLine({ data }){
  const ref = useRef(null);
  const wrap = useRef(null);
  useEffect(() => {
    const cvs = ref.current, el = wrap.current;
    if(!cvs || !el || !data || data.length < 2) return;
    const W = el.clientWidth || 280, H = 84, dpr = window.devicePixelRatio || 1;
    cvs.width = W*dpr; cvs.height = H*dpr;
    cvs.style.width = W + 'px'; cvs.style.height = H + 'px';
    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    let lo = Infinity, hi = -Infinity;
    for(let q=0;q<data.length;q++){ if(data[q] < lo) lo = data[q]; if(data[q] > hi) hi = data[q]; }
    if(hi - lo < 0.5){ hi += 0.5; lo -= 0.5; }
    const x = q => 4 + q/(data.length-1)*(W-8);
    const y = v => 6 + (hi - v)/(hi - lo)*(H-12);
    if(0 >= lo && 0 <= hi){
      ctx.strokeStyle = 'rgba(143,176,172,.35)'; ctx.lineWidth = 1;
      ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(4, y(0)); ctx.lineTo(W-4, y(0)); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = data[data.length-1] >= 0 ? '#2fd6ae' : '#ff6b5e';
    ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    ctx.beginPath();
    for(let q=0;q<data.length;q++){
      if(q === 0) ctx.moveTo(x(q), y(data[q]));
      else ctx.lineTo(x(q), y(data[q]));
    }
    ctx.stroke();
  }, [data]);
  return <div ref={wrap} style={{width:'100%'}}><canvas ref={ref} /></div>;
}
