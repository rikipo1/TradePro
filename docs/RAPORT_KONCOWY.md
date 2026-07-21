# RAPORT KOŃCOWY — modernizacja Rikipo Trader wg audytu instytucjonalnego

Data: 2026-07-13 · wersja: 1.7.0 · gałąź: `claude/apk-build-update-4lv00q`
Zakres: Etapy 1–4 briefu (A1–A10, E2-1…E2-5, E3-1…E3-6, E4-1…E4-5) — wdrożone w całości.

## 1. Testy

`npm test`: **80 / 80 zielonych** (node:test). Pokrycie: k-fold + kalibracja
pooled OOS, bramki decyzyjne (golden testy 1:1 po refaktorze), payout/EV
empiryczne, risk engine v2, sesje/okna makro (DST), koszty paper, slippage,
monitoring/degradacja, shadow-vs-backtest, wersjonowanie modelu, portfolio
(VaR-lite), sizing, adaptive control, decision journal.

## 2. Ablacja (E2-1)

Mechanizm `__ablate` + harness (`scripts/ablation.js`, przycisk 🔬) wdrożone
i przetestowane. **Reguła usuwania elementów niewykonywalna na dostępnych
danych** — na DE40/US500/EURUSD × M5/M15/H1 żadna konfiguracja nie osiąga
30 rozstrzygniętych etykiet (TP1/SL) potrzebnych do treningu. Pełne tabele:
`docs/ABLACJA.md`. Żaden element toru decyzyjnego nie został usunięty.

## 3. Metryki OOS per instrument (zaostrzone reliable, dane realne Yahoo)

| instrument | TF | świece | wynik k-fold |
|---|---|---|---|
| DE40 (^GDAXI) | M5 | 3061 | trening niemożliwy — za mało próbek (min 30) |
| DE40 (^GDAXI) | M15 | 2032 | trening niemożliwy — za mało próbek (min 30) |
| US500 (^GSPC) | M5 | 2341 | trening niemożliwy — za mało próbek (min 30) |
| US500 (^GSPC) | M15 | 1561 | trening niemożliwy — za mało próbek (min 30) |
| EURUSD | M5 | 8325 | trening niemożliwy — za mało próbek (min 30) |
| EURUSD | M15 | 5598 | trening niemożliwy — za mało próbek (min 30) |

System generuje ~1 wejście/400 świec, a 50–70% wyników to BE/TIMEOUT
(z definicji K5 poza etykietami). Do progu **reliable** (≥200 transakcji OOS)
potrzeba rzędu **kilkuset tysięcy świec** — Yahoo daje 30–60 dni intraday.
Wniosek: **na obecnym feedzie model wyuczony nie może osiągnąć statusu
reliable** — i poprawnie NIE jest używany live (DEFAULT_WEIGHTS, stały
sizing, kalibracja off). To działanie zgodne z projektem, nie usterka.

## 4. Shadow-vs-Backtest (E3-2)

Raport wdrożony (werdykt automatyczny OK / NIEWYJAŚNIONA). **Brak ≥30
wspólnych transakcji** — dziennik paper jest świeży. Wynik: N/D do czasu
zebrania próby.

## 5. Pozostałe ryzyka

1. **Dane**: Yahoo = 30–60 dni intraday (M5/M15), ~15 min opóźnienia dla
   indeksów bez Capital.com; podaż etykiet za mała do treningu/ablacji.
   Mitygacja: podłączyć dłuższą historię (Capital.com / eksport CSV).
2. **Brak realnego wykonania**: paper nie modeluje częściowych wypełnień,
   rekwotowań, spreadu nocnego; slippage tylko w backteście (pesymistycznie).
3. **VaR-lite zakłada normalność** zwrotów — ogony niedoszacowane; limity
   (2% sumy ryzyka, 3% VaR) traktować twardo.
4. **Korelacje ze skanera** liczone z ≤200 zamknięć M5 — niestabilne przy
   krótkiej historii; portfolioCheck traktuje brak ρ jak 0.
5. **Multiple testing**: mimo E2-3 (2 treningi ≥24 h) wielokrotne treningi
   na tych samych danych mogą wyłuskać szczęśliwą konfigurację.

## 6. Rekomendacja: **PAPER ONLY**

Uzasadnienie liczbami: 0 instrumentów z treningiem możliwym na dostępnych
danych (tabela wyżej), 0 wspólnych transakcji shadow, dziennik < 30 wpisów.
Architektura i zabezpieczenia są kompletne, ale żaden warunek dopuszczenia
kapitału realnego nie jest spełniony liczbowo.

### Checklista dopuszczenia do rozważenia małego kapitału realnego

- [x] wszystkie etapy wdrożone, testy zielone (80/80);
- [ ] reliable (zaostrzone, potwierdzone 2 treningami) na docelowej parze —
      **niemożliwe na obecnym feedzie danych**;
- [ ] ≥200 transakcji paper na tej parze, Shadow-vs-Backtest „OK";
- [ ] rolling Brier live < 0.25; brak aktywnej degradacji;
- [x] monitoring i portfolioCheck aktywne (auto-revert + bramki wdrożone).

### Co musi się wydarzyć, żeby podnieść rekomendację

1. Dłuższa historia intraday (Capital.com API / CSV) → ablacja + trening
   z realną szansą na n_oos ≥ 200.
2. ≥200 zamkniętych transakcji paper na docelowej parze (DE40·M5 lub M15).
3. Shadow-vs-Backtest „OK" na ≥30 wspólnych transakcjach.
4. Rolling Brier live < 0.25 przy braku degradacji przez ≥20 transakcji.

*Pętla końcowa (komitet inwestycyjny): przy obecnych liczbach nie ma podstaw
do rekomendacji wyższej niż PAPER ONLY; kolejne zmiany kodu nie poprawią OOS,
bo ograniczeniem jest podaż danych, nie silnik.*
