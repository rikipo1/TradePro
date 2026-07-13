/* ---------------- Analiza wielointerwałowa (MTF) ----------------
   Agreguje świece bieżącego TF do wyższych ramek i ocenia kierunek każdej
   (EMA-stack + struktura). Zwraca ważony konsensus w [-1, 1].
   UCZCIWOŚĆ: z jednego feedu OHLCV da się zbudować tylko ramki WYŻSZE od
   bieżącej i tylko tak głęboko, jak sięga historia — nie udajemy 1W na
   danych z 5 dni. Ramki bez wystarczającej liczby świec są pomijane. */

import { emaOver, atrSeries } from '../indicators/index.js';
import { zigzag } from '../patterns/index.js';
import { marketStructure } from '../smc/index.js';

export const MTF_FRAMES = [
  { id: 'M15', sec: 900,    w: 0.15 },
  { id: 'M30', sec: 1800,   w: 0.15 },
  { id: 'H1',  sec: 3600,   w: 0.25 },
  { id: 'H4',  sec: 14400,  w: 0.20 },
  { id: 'D1',  sec: 86400,  w: 0.25 },
];

export function aggregateTf(candles, stepSec) {
  const buckets = new Map();
  for (let q = 0; q < candles.length; q++) {
    const c = candles[q];
    const key = Math.floor(c.t / stepSec) * stepSec;
    let b = buckets.get(key);
    if (!b) { b = { t: key, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v || 0 }; buckets.set(key, b); }
    else { if (c.h > b.h) b.h = c.h; if (c.l < b.l) b.l = c.l; b.c = c.c; b.v += (c.v || 0); }
  }
  return Array.from(buckets.values()).sort((a, b) => a.t - b.t);
}

/* kierunek jednej ramki: struktura (priorytet) + EMA stack; 0 gdy niejasny */
export function frameDir(agg) {
  if (!agg || agg.length < 30) return null; // za mało danych — ramka pominięta
  const closes = agg.map(x => x.c);
  const e20 = emaOver(closes, 20), e50 = emaOver(closes, 50);
  const i = closes.length - 1;
  let emaDir = 0;
  if (e20[i] != null && e50[i] != null) {
    if (closes[i] > e20[i] && e20[i] > e50[i]) emaDir = 1;
    else if (closes[i] < e20[i] && e20[i] < e50[i]) emaDir = -1;
  }
  let structDir = 0;
  try {
    const atrH = atrSeries(agg, 14);
    const piv = zigzag(agg, atrH);
    const ms = marketStructure(piv, agg.length - 1);
    if (ms) structDir = ms.trend;
  } catch (e) {}
  if (structDir !== 0 && emaDir !== 0) return structDir === emaDir ? structDir : 0;
  return structDir !== 0 ? structDir : emaDir;
}

/* konsensus MTF: { align: [-1..1], frames: [{id, dir}], usedW } */
export function mtfConsensus(candles, tfSec) {
  const frames = [];
  let sum = 0, usedW = 0;
  for (const f of MTF_FRAMES) {
    if (f.sec <= tfSec) continue;              // tylko ramki wyższe od bieżącej
    const agg = aggregateTf(candles, f.sec);
    const dir = frameDir(agg);
    if (dir == null) continue;                 // za mało historii dla tej ramki
    frames.push({ id: f.id, dir, bars: agg.length });
    sum += dir * f.w;
    usedW += f.w;
  }
  return { align: usedW > 0 ? +(sum / usedW).toFixed(2) : 0, frames, usedW: +usedW.toFixed(2) };
}
