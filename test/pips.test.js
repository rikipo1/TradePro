import { describe, it, expect } from 'vitest';
import { pipSize, toPips, fmtPips } from '../src/constants/instruments.js';

describe('pips — rozmiar pipsa per klasa', () => {
  it('indeksy: 1 pip = 1 punkt', () => {
    expect(pipSize('^GDAXI')).toBe(1);
    expect(toPips('^GDAXI', 23.0)).toBe(23);        // 23 punkty = 23 pip
    expect(toPips('^IXIC', -15)).toBe(15);          // wartość bezwzględna
  });
  it('FX majors: 0.0001; para z JPY: 0.01', () => {
    expect(pipSize('EURUSD=X')).toBeCloseTo(0.0001, 8);
    expect(toPips('EURUSD=X', 0.0012)).toBe(12);    // 12 pipsów
    expect(pipSize('USDJPY=X')).toBeCloseTo(0.01, 8);
    expect(toPips('USDJPY=X', 0.35)).toBe(35);
  });
  it('złoto: 0.1', () => {
    expect(pipSize('GC=F')).toBeCloseTo(0.1, 8);
    expect(toPips('GC=F', 2.5)).toBe(25);           // ruch 2.5 = 25 pip
  });
  it('krypto: 1', () => {
    expect(pipSize('BTC-USD')).toBe(1);
    expect(toPips('BTC-USD', 120)).toBe(120);
  });
  it('fmtPips formatuje i obsługuje brak danych', () => {
    expect(fmtPips('^GDAXI', 40)).toBe('40 pip');
    expect(fmtPips('^GDAXI', null)).toBe('—');
    expect(toPips('^GDAXI', null)).toBeNull();
  });
});
