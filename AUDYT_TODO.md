# AUDYT_TODO — modernizacja wg audytu instytucjonalnego (2026-07-12)

Zasada nadrzędna: tor decyzyjny live bit-w-bit identyczny z torem walidowanym
w k-fold (parytet validate↔serve). Backtest zawsze pesymistyczny.

## ETAP 1 — krytyczne poprawki bezpieczeństwa i metodologii (v1.4.0)

- [x] **A1** Kalibracja produkcyjna WYŁĄCZNIE z pooled OOS (`walkForwardKFold`,
      `prodCalib = fitIsotonic(pooledOosPairs, 150)`; przebieg prod tylko do
      diagnostyki `prodInSample`)
- [x] **A2** kNN poza torem decyzyjnym (`blendProb` usunięte z computeSignal;
      `out.similar` zostaje jako diagnostyka)
- [x] **A3** `__reliable` jako twarda bramka użycia wag/kalibracji; skaner tła
      (`analyzeSymbol`) i wykres liczą na tym samym modelu
- [x] **A4** EV z empirycznej dystrybucji wypłat (`computePayout` z pooled OOS,
      `expectedValueEmpirical`, `out.evModel`)
- [x] **A5** Risk Engine v2: floating risk (tylko na minus), limit otwartych
      pozycji (maxOpen=2), doba UTC + M4-proxy (skalowanie ×0.5 dla tej samej
      klasy instrumentu w tym samym kierunku)
- [x] **A6** Sesje i okna makro w czasie LOKALNYM rynków (Intl, DST-proof)
- [x] **A7** Koszty transakcyjne w paper (costR przy każdym zamknięciu;
      metadane prob/ev/evModel/regime/riskPct w dzienniku)
- [x] **A10** Higiena: martwy `sawTp2` usunięty, fallback ATR bez lookaheadu

## ETAP 2 — jakość sygnałów (v1.5.0)

- [x] **E2-1** Harness ablacyjny (`scripts/ablation.js`, flagi `__ablate`)
- [x] **E2-2 [A8]** Zaostrzenie progu `reliable` (n≥200, med>0, p25>−0.05,
      Brier p75<0.25, regimeCoverage≥2)
- [x] **E2-3** Potwierdzenie dwoma treningami (`reliableStreak`)
- [x] **E2-4** Cooldown 60 s + budżet czasu treningu (M7/M8)
- [x] **E2-5** Higiena progu minProb (ostrzeżenie + `rt_paramlog`)

## ETAP 3 — monitoring, walidacja ciągła, wykonanie (v1.6.0)

- [x] **E3-1** Monitoring Engine (rollingStats, degradation, auto-revert,
      bramka stale)
- [x] **E3-2** Raport Shadow-vs-Backtest (`compareShadow`)
- [x] **E3-3** Poślizg SL + spread dynamiczny (slipAtr per klasa, koszt ×4
      w oknie makro, auto-trade zablokowany w oknie makro)
- [x] **E3-4** C4 — świece do trailingu strukturalnego w paper
- [x] **E3-5** Wersjonowanie modelu + rollback (Model Risk Governance)
- [x] **E3-6** Refaktor computeSignal (gates.js / levels.js) z golden testami

## ETAP 4 — zarządzanie kapitałem (v1.7.0)

- [ ] **E4-1** Portfolio Risk Engine (korelacje, cap sumaryczny, VaR-lite)
- [ ] **E4-2** Capital Allocation (scale z portfolioCheck, tryb obronny)
- [ ] **E4-3** Adaptive Learning Control (walidacja zmian parametrów + rollback)
- [ ] **E4-4** Decision Journal — komplet pól + eksport JSON
- [ ] **E4-5** Finalna walidacja i raport (`docs/RAPORT_KONCOWY.md`)
