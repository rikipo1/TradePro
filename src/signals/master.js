/* ================== SILNIK NADRZĘDNY „MASTER" ==================
   JEDEN werdykt zamiast trzech osobnych (silnik / ranking / MTF), które
   potrafiły sobie przeczyć. Analiza top-down jak u profesjonalnego tradera:

     1. DRABINA INTERWAŁÓW (bieżący + wszystkie wyższe, agregowane z jednego
        feedu) nadaje KIERUNEK — wyższa ramka waży więcej. Master nigdy nie
        gra przeciwko zgodnej drabinie wyższych interwałów (twarde VETO).
     2. Zwalidowany silnik k-fold (computeSignal) pozostaje WYZWALACZEM
        wejścia — master nie dorabia sygnału, którego silnik nie dał
        (parytet validate↔serve z audytu). Może wejście tylko WSTRZYMAĆ.
     3. Ranking 🏛 (20 detektorów) działa jako KONFLUENCJA: zgodność
        podnosi zaufanie, sprzeczność je ścina. Gdy silnik czeka, a ranking
        ma gotowy setup zgodny z drabiną — master pokazuje go jawnie jako
        stan WARUNKOWY ('setup'), nie jako pełne wejście.

   Wyjście: { dir, verdict, state: 'entry'|'setup'|'wait', confidence 5–95,
   grade, readiness 0–100, lean, veto, label, reasons[], ladder[], align,
   levels, srcStrategy, agree } — wszystko, czego potrzebuje UI, w jednym
   spójnym obiekcie. */

import { aggregateTf, frameDir, MTF_FRAMES } from '../strategies/mtf.js';
import { waitStage } from './waitStage.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function gradeOf(conf) {
  return conf >= 80 ? 'A+' : conf >= 70 ? 'A' : conf >= 60 ? 'B' : conf >= 45 ? 'C' : 'D';
}

/* drabina interwałów: bieżąca ramka + wszystkie wyższe, które da się
   uczciwie zbudować z historii (ramki z <30 świec pomijane — bez udawania) */
export function tfLadder(candles, tfId, tfSec) {
  const ladder = [];
  const curDir = frameDir(candles);
  ladder.push({ id: tfId || 'TF', sec: tfSec, dir: curDir == null ? 0 : curDir, bars: candles.length, cur: true });
  let sum = 0, usedW = 0;
  for (const f of MTF_FRAMES) {
    if (f.sec <= tfSec) continue;
    const agg = aggregateTf(candles, f.sec);
    const dir = frameDir(agg);
    if (dir == null) continue;
    ladder.push({ id: f.id, sec: f.sec, dir, bars: agg.length, w: f.w });
    sum += dir * f.w;
    usedW += f.w;
  }
  return { ladder, align: usedW > 0 ? +(sum / usedW).toFixed(2) : 0, usedW: +usedW.toFixed(2) };
}

export function masterVerdict({ candles, tfId, tfSec, signal, rank }) {
  if (!candles || candles.length < 60) return null;
  const { ladder, align, usedW } = tfLadder(candles, tfId, tfSec || 300);
  const sigDir = signal && !signal.stale ? signal.dir : 0;
  const rankDir = rank ? rank.dir : 0;
  const rankConf = rank && rank.dir !== 0 ? (rank.confidence || 0) : 0;
  const fmtAlign = (a) => (a > 0 ? '+' : '') + a;

  /* etap lejka przy CZEKAJ (zachowuje dotychczasową funkcję „czekaj") */
  const ws = signal && signal.dir === 0 && !signal.stale ? waitStage(signal) : null;

  let dir = 0, state = 'wait', veto = null, srcStrategy = null;

  if (signal && signal.stale) {
    state = 'wait';
  } else if (sigDir !== 0) {
    /* twarde veto: drabina wyższych interwałów wyraźnie PRZECIW wejściu */
    if (usedW > 0 && align * sigDir <= -0.45) {
      veto = 'wyższe interwały przeciw (' + fmtAlign(align) + ') — nie walczymy z trendem wyższego rzędu';
    } else {
      dir = sigDir;
      state = 'entry';
    }
  } else if (rankDir !== 0) {
    if (usedW > 0 && align * rankDir <= -0.45) {
      veto = 'setup 🏛 pod prąd wyższych interwałów (' + fmtAlign(align) + ') — odrzucony';
    } else {
      dir = rankDir;
      state = 'setup'; // scenariusz gotowy wg rankingu; silnik jeszcze nie potwierdził
      srcStrategy = rank.best ? rank.best.id : null;
    }
  }

  /* zaufanie 0–100: baza z właściwego źródła + kontekst drabiny + konfluencja */
  let confidence = 0;
  if (dir !== 0) {
    const base = state === 'entry'
      ? (signal.setupScore != null ? signal.setupScore : 50)
      : Math.round(rankConf * 0.75);                    // setup bez potwierdzenia — dyskonto
    const htfBonus = Math.round(align * dir * 20);      // −20…+20 od drabiny
    const crossBonus = state === 'entry'
      ? (rankDir === dir ? Math.round(rankConf / 10)    // ranking zgodny: do +10
        : rankDir !== 0 ? -12 : 0)                      // ranking przeciwny: −12
      : 0;
    const warnPen = signal && signal.warns ? Math.min(10, signal.warns.length * 3) : 0;
    const riskPen = rank && rank.scores ? Math.round((rank.scores.risk || 0) / 12) : 0;
    confidence = clamp(base + htfBonus + crossBonus - warnPen - riskPen, 5, 95);
    /* setup warunkowy (bez potwierdzenia silnika) nigdy nie przebija
       pewności rankingu, który go wykrył — bonusy kontekstu nie mogą
       zamienić scenariusza w „pewniaka" */
    if (state === 'setup') confidence = Math.min(confidence, Math.max(5, rankConf - 5));
  }

  /* gotowość do paska: wejście=100, setup wysoko, czekaj wg etapu lejka */
  const readiness = state === 'entry' ? 100
    : state === 'setup' ? clamp(60 + Math.round(confidence / 4), 60, 92)
    : veto ? 25
    : ws ? Math.round(ws.stage / ws.stages * 70)
    : 10;

  /* przechył przy CZEKAJ: lejek → drabina → ranking */
  let lean = 0;
  if (dir === 0) {
    lean = ws && ws.lean !== 0 ? ws.lean
      : Math.abs(align) >= 0.3 ? (align > 0 ? 1 : -1)
      : rankDir;
  }

  const label = signal && signal.stale ? 'dane nieaktualne — werdykt wstrzymany'
    : veto ? 'VETO drabiny interwałów — czekaj na zgodność'
    : state === 'entry' ? ('WEJŚCIE — silnik potwierdzony, interwały ' + (align * dir > 0.15 ? 'zgodne' : 'neutralne'))
    : state === 'setup' ? 'setup warunkowy 🏛 — silnik jeszcze nie potwierdził'
    : ws ? ('etap ' + ws.stage + '/' + ws.stages + ': ' + ws.label)
    : 'brak przewagi statystycznej';

  const reasons = [];
  reasons.push(ladder.map(f => f.id + (f.dir > 0 ? '▲' : f.dir < 0 ? '▼' : '•')).join(' · ')
    + ' — zgodność drabiny ' + fmtAlign(align));
  if (signal) {
    reasons.push(sigDir !== 0
      ? 'silnik k-fold: ' + (sigDir > 0 ? 'LONG' : 'SHORT')
        + (signal.setupScore != null ? ' · P(win) ' + signal.setupScore + '%' : '')
        + (signal.ev != null ? ' · EV ' + (signal.ev > 0 ? '+' : '') + signal.ev + 'R' : '')
      : signal.stale ? 'silnik k-fold: wstrzymany (dane nieaktualne)'
      : 'silnik k-fold: CZEKAJ' + (ws ? ' (etap ' + ws.stage + '/' + ws.stages + ')' : ''));
  }
  if (rank) {
    reasons.push(rankDir !== 0
      ? 'ranking 🏛: ' + (rankDir > 0 ? 'KUP' : 'SPRZEDAJ') + ' ' + rankConf + '%'
        + (rank.best ? ' — ' + rank.best.name : '')
        + (sigDir !== 0 ? (rankDir === sigDir ? ' · ZGODNY z silnikiem' : ' · PRZECIWNY do silnika — ostrożnie') : '')
      : 'ranking 🏛: brak setupu ≥ progu');
  }
  if (veto) reasons.push('VETO: ' + veto);
  if (rank && rank.scores && rank.scores.risk >= 50) {
    reasons.push('ryzyko otoczenia ' + rank.scores.risk + '/100 (sesja · zmienność · makro)');
  }

  const levels = state === 'entry' ? (signal.levels || null)
    : state === 'setup' ? (rank.levels || null)
    : null;

  return {
    dir,
    verdict: dir > 0 ? 'LONG' : dir < 0 ? 'SHORT' : 'CZEKAJ',
    state, confidence,
    grade: dir !== 0 ? gradeOf(confidence) : '—',
    readiness, lean, veto, label, reasons,
    ladder, align,
    levels, srcStrategy,
    agree: { engine: sigDir, ranking: rankDir, htf: align },
  };
}
