# AUDYT — TODO (świadomie NIE zrobione w tej turze)

Ta lista zbiera zadania celowo pominięte w audycie `fix/quant-fundamentals-audit`
(gałąź robocza: `claude/quant-fundamentals-audit-ueqicm`) oraz ryzyka/niejasności
wykryte po drodze. Nic tu nie jest „zepsute" — to świadomy zakres na kolejne iteracje.

## Odłożone zadania (z briefu)

- **C4 — feed brokera (Capital.com jako źródło świec/tików do paper)**
  Paper live dalej pracuje na tiku 15 s z `fetchQuotes`/`capitalTick` (tylko cena).
  Brak realnego strumienia świec do trailingu strukturalnego w paper → obecnie
  fallback 1R (flaga `trailApprox`). TODO: pobrać ostatnie świece z tego samego
  źródła co monitor i podać do `stepPositionTick({trailLow,trailHigh,atr})`.

- **M4 — ryzyko PORTFELOWE w sizingu**
  `positionSizing` liczy ryzyko per-trade. Korelacja ekspozycji jest tylko
  ostrzeżeniem w skanerze (`duplicatesExposure`), nie wchodzi do wielkości pozycji.
  TODO: skaluj `riskPct` w dół, gdy otwarta jest skorelowana pozycja.

- **M7/M8 — cooldown / timeout w treningu**
  Brak throttlingu wielokrotnego klikania „Trenuj wagi" i twardego limitu czasu
  pętli k-fold na słabym urządzeniu. TODO: cooldown + budżet czasu z przerwaniem.

- **N6 — pełny refaktor `computeSignal`**
  `signals/engine.js` (`computeSignal`) to wciąż jedna długa funkcja mieszająca
  diagnostykę (`score`/`reasons`) z torem decyzyjnym (factors→prob→EV). Tor
  decyzyjny jest już odseparowany od `score` (W2), ale funkcja wymaga rozbicia na
  moduły (levels, gating, session/macro). TODO: refactor bez zmiany zachowania.

## Wykryte ryzyka / niejasności

- **`W` w `pullback.js` — NIE jest niezdefiniowane.**
  Brief sugerował, że `W` może być niezdefiniowaną stałą. W rzeczywistości `W` to
  zdefiniowana mapa wag konfluencji (`pullback.js:10–13`). Nie ruszano. Żadnych
  „zgadywanych" wartości nie dodano.

- **M1 — DST (czas letni) w sesjach/oknach makro.**
  `utils/sessions.js` liczy teraz sesje i okna makro z UTC (spójnie live/backtest),
  ale mapowanie CET→UTC używa STAŁEGO offsetu zimowego (UTC+1). Latem (CEST, UTC+2)
  okna są przesunięte o ~1 h. Wpływ mały (sesje są tylko modyfikatorem jakości/
  informacją), ale TODO: wyznaczać offset z realnej strefy rynku. Oznaczone
  `TODO(M1-DST)` w kodzie.

- **Bufor próbek między-sesyjny a indeksy `i0/i1`.**
  Zbuforowane próbki (`rt_samples_*`) z poprzednich pobrań mają `i0/i1` względem
  INNEJ tablicy świec. Dlatego są używane WYŁĄCZNIE do treningu wag produkcyjnych
  (pula `priorSamples`), a NIE do indeksowego przydziału fold OOS ani embargo —
  OOS pozostaje uczciwe (liczone tylko z bieżących świec). Świadoma decyzja.

- **`trailApprox` w paper.**
  Trailing paper na tiku 15 s może przeoczyć intrabar stop-hunt — backtest jest
  pesymistyczny (SL-first z realnym low/high). Różnica UDOKUMENTOWANA flagą
  `trailApprox` na wpisie dziennika (nie udajemy, że tory są identyczne).
