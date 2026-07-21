#!/usr/bin/env node
/* [E2-1] CLI harnessu ablacyjnego.
   Użycie:
     node scripts/ablation.js <plik.json>            # świece z pliku JSON [{t,o,h,l,c,v}, …]
     node scripts/ablation.js <SYMBOL> [TF] [range]  # świece z Yahoo (np. ^GDAXI M15 30d)
   Wynik: tabela konfiguracja | n_oos | med(avgR) | med(PF) | med(win%) | p75(Brier). */

import fs from 'node:fs';
import { ablationTable, ablationAscii } from '../src/backtest/ablation.js';

const TF_YF = { M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '60m', D1: '1d' };

async function loadCandles(arg, tfId, range) {
  if (fs.existsSync(arg)) return JSON.parse(fs.readFileSync(arg, 'utf8'));
  const interval = TF_YF[tfId] || '5m';
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(arg)
    + '?range=' + range + '&interval=' + interval;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('Yahoo HTTP ' + r.status);
  const j = await r.json();
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error('brak danych z Yahoo');
  const ts = res.timestamp || [];
  const q = res.indicators.quote[0];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
    out.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: (q.volume && q.volume[i] != null) ? q.volume[i] : 0 });
  }
  return out;
}

const [, , arg, tfId = 'M5', range = '30d'] = process.argv;
if (!arg) {
  console.error('Użycie: node scripts/ablation.js <plik.json | SYMBOL> [TF=M5] [range=30d]');
  process.exit(1);
}
const candles = await loadCandles(arg, tfId, range);
console.log('# Ablacja: ' + arg + ' · ' + tfId + ' · ' + candles.length + ' świec');
const rows = ablationTable(candles, fs.existsSync(arg) ? '^GDAXI' : arg, tfId);
console.log(ablationAscii(rows));
