import React, { useEffect, useRef } from 'react';

export function Sparkline({ data, up }){
  const ref = useRef(null);
  useEffect(() => {
    const cvs = ref.current;
    if(!cvs || !data || data.length < 2) return;
    const W = 72, H = 30, dpr = window.devicePixelRatio || 1;
    cvs.width = W*dpr; cvs.height = H*dpr;
    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);
    let lo = Infinity, hi = -Infinity;
    for(let i=0;i<data.length;i++){ if(data[i]<lo) lo=data[i]; if(data[i]>hi) hi=data[i]; }
    if(hi - lo <= 0){ hi = lo + 1; }
    const x = i => 2 + i/(data.length-1) * (W-4);
    const y = v => 3 + (hi - v)/(hi - lo) * (H-6);
    const col = up ? '#2fd6ae' : '#ff6b5e';
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    for(let i=0;i<data.length;i++){
      if(i === 0) ctx.moveTo(x(i), y(data[i]));
      else ctx.lineTo(x(i), y(data[i]));
    }
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x(data.length-1), y(data[data.length-1]), 2, 0, Math.PI*2);
    ctx.fill();
  }, [data, up]);
  return <canvas ref={ref} style={{width:72, height:30, flexShrink:0}} />;
}

/* ===================== [5a] EKRAN: OBSERWOWANE ====================== */
