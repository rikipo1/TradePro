# Rikipo Trader

Prywatne narzędzie **analityczno-edukacyjne** do analizy rynków (indeksy, forex,
złoto, krypto). Notowania z Yahoo Finance / Stooq oraz opcjonalnie **realtime
LIVE z Capital.com**. Silnik wskaźników, detektor formacji świecowych i
geometrycznych, analiza **Smart Money Concepts (SMC)**, silnik sygnałów
(confluence), analiza AI (Claude / Gemini), backtest oraz dziennik transakcji
(paper trading).

> ⚠️ Aplikacja nie stanowi porady inwestycyjnej. Handel CFD wiąże się z wysokim
> ryzykiem utraty kapitału.

## Zmiany

### v1.8.0 — 🏛 Instytucjonalny silnik rankingu strategii (moduł doradczy)

- **14 detektorów strategii** ocenianych RÓWNOCZEŚNIE na każdej świecy, każdy
  0–100%: Trend Following, Momentum/Expansion, Breakout (Donchian), Break &
  Retest, Liquidity Sweep/Stop Hunt (ICT), Wyckoff Spring/Upthrust, Mean
  Reversion, Order Block, FVG/Imbalance, Premium/Discount, VWAP pullback,
  Volatility Squeeze, Session Open Drive (killzones), Pivot Points.
- **Wielointerwałowość**: świece agregowane do M15/M30/H1/H4/D1 z wagami;
  zgodność MTF premiowana, kontra karana. Ramki bez wystarczającej historii
  są pomijane (bez udawania).
- **Werdykt**: LONG / SHORT / **BRAK TRANSAKCJI** (poniżej progu przewagi
  wejście nie jest wymuszane — brak pozycji to poprawna decyzja). Entry, SL,
  **TP1–TP4**, trailing strukturalny, R:R, szacunek P(win), Confidence oraz
  sub-scores: struktura/trend/momentum/płynność/zmienność/ryzyko.
- **Explain AI**: dlaczego ta strategia, dlaczego odrzucone pozostałe, co
  unieważni analizę, jakie warunki muszą być spełnione, co zwiększy szansę.
- **System uczenia**: wyniki paper otwartych z rankingu (pole `strategy`)
  korygują scoring z twardym **shrinkage** (min 10 tr na jakąkolwiek korektę,
  pełna siła dopiero przy dziesiątkach transakcji — anty-overfitting).
- **Uczciwe granice**: moduł DORADCZY (auto-trade nadal na zwalidowanym
  silniku k-fold — parytet validate↔serve); Order Flow/DOM/Footprint/delta
  wymagają danych tick/L2, których feed nie dostarcza — nie są symulowane;
  scoring to heurystyka, kalibracja tylko z własnej historii ≥30 tr.

### v1.7.0 — Etap 4 audytu: zarządzanie kapitałem (portfel)

- **[E4-1]** Portfolio Risk Engine: cap sumy ryzyka (2%), skalowanie/blokada
  pozycji skorelowanych (|ρ|>0.7), parametryczny VaR-lite (limit 3%) —
  każde otwarcie paper przechodzi przez `portfolioCheck`.
- **[E4-2]** sizing z kosztem (edge − costR), skalą portfelową i **trybem
  obronnym** (drawdown > 5R ⇒ ryzyko ×0.5).
- **[E4-3]** Adaptive Learning Control: zmienione progi SMC wymagają
  walidacji k-fold vs stare na tych samych świecach; gorsze ⇒ auto-rollback.
- **[E4-4]** Decision Journal — komplet pól (sesja, snapshot czynników,
  modelV…) + eksport JSON dziennika.
- **[E4-5]** `docs/RAPORT_KONCOWY.md` — finalna walidacja; rekomendacja:
  **PAPER ONLY** (uzasadnienie liczbami).
- **[fix]** trening wag i backtest liczą teraz na **maksymalnej historii Yahoo**
  (M5→60 dni, H1→2 lata) zamiast na 5 dniach z wykresu — 3–5× więcej etykiet
  TP1/SL. Komunikat „za mało próbek" zastąpiony konkretem („zebrano 9 z 30 —
  na 6042 świecach 16 transakcji, reszta BE/TIMEOUT; spróbuj większy interwał
  lub bardziej zmienny instrument").

### v1.6.0 — Etap 3 audytu: monitoring, walidacja ciągła, wykonanie

- **[E3-1]** Monitoring Engine: rolling stats z dziennika vs walidacja k-fold,
  automatyczny **revert do wag domyślnych** przy degradacji; twarda bramka
  świeżości danych (`{stale:true}` przy świecach starszych niż 2×TF+90 s);
  licznik świeżości per źródło w INFO.
- **[E3-2]** raport **Shadow-vs-Backtest** w dzienniku z automatycznym
  werdyktem (OK / NIEWYJAŚNIONA — nie zwiększaj zaufania).
- **[E3-3]** poślizg SL w backteście (slipAtr per klasa), koszt spreadu ×4
  w oknach makro, **auto-trade zablokowany w oknie makro**.
- **[E3-4]** trailing strukturalny w paper (świece w monitorze pozycji;
  flaga `trailApprox` znika, gdy dane dostępne).
- **[E3-5]** wersjonowanie modelu (max 3, FIFO) + rollback z UI; `modelV`
  w dzienniku.
- **[E3-6]** refaktor computeSignal na `gates.js`/`levels.js` z golden
  testami 1:1 (zero zmiany zachowania).

### v1.5.0 — Etap 2 audytu: jakość sygnałów

- **[E2-1]** harness ablacyjny (`scripts/ablation.js`, flagi `__ablate`,
  przycisk 🔬 w modalu backtestu). Wynik na danych rzeczywistych
  (DE40/US500/EURUSD × M5/M15/H1): **reguła usuwania elementów
  niewykonywalna** — podaż etykiet TP1/SL na zakresach Yahoo jest za mała,
  by trenować i porównywać konfiguracje (szczegóły: `docs/ABLACJA.md`).
  Żaden element toru decyzyjnego nie został usunięty.
- **[E2-2]** **nowa definicja `reliable`**: n_oos ≥ 200 ∧ med(avgR) > 0 ∧
  p25(avgR) > −0.05 ∧ Brier p75 < 0.25 ∧ pokrycie ≥ 2 reżimów; UI pokazuje,
  który warunek nie przeszedł.
- **[E2-3]** pełna aktywacja modelu dopiero po **2 kolejnych treningach**
  reliable w odstępie ≥24 h (stan „kandydat 1/2").
- **[E2-4]** cooldown 60 s przycisku treningu + twardy budżet czasu k-fold.
- **[E2-5]** log zmian parametrów decyzyjnych (`rt_paramlog`) + ostrzeżenie
  „zmiana niezwalidowana" w panelu strojenia.

### v1.4.0 — Etap 1 audytu: krytyczne poprawki metodologii i ryzyka

- **[A1]** trening przez **walk-forward k-fold**; kalibracja isotonic
  produkcyjna fitowana **wyłącznie na pooled OOS** (nigdy in-sample).
- **[A2]** kNN (similarity) wyłączone z toru decyzyjnego — zostaje jako
  diagnostyka UI (parytet validate↔serve).
- **[A3]** wagi/kalibracja aktywne tylko z flagą `__reliable`; skaner tła
  i wykres liczą na identycznym modelu.
- **[A4]** bramka EV liczy z **empirycznej dystrybucji wypłat** (partial+runner,
  udział BE/TIMEOUT) z pooled OOS; fallback: formuła liniowa.
- **[A5]** Risk Engine v2: floating risk (tylko na minus), limit jednoczesnych
  pozycji, doba w UTC, skalowanie ryzyka ×0.5 dla skorelowanej klasy.
- **[A6]** sesje i okna makro w **czasie lokalnym rynków** (DST-proof, Intl).
- **[A7]** koszty transakcyjne w paper tradingu + metadane wpisów
  (prob/ev/evModel/regime/riskPct).
- **[A10]** higiena: martwy `sawTp2`, fallback ATR bez lookaheadu.
- testy jednostkowe (`npm test`, node:test) dla całego toru decyzyjnego.

Wcześniej całość była jednym plikiem `index.html` (~5,7 tys. linii, React
kompilowany w przeglądarce przez Babel + biblioteki z CDN). Została rozbita na
modułową aplikację **Vite + React** z podziałem na warstwy: dane, wskaźniki,
formacje, SMC, sygnały, AI, backtest, komponenty i ekrany.

## Wymagania

- Node.js 18+ (zalecane 20+)

## Uruchomienie

```bash
npm install       # instalacja zależności
npm run dev       # serwer deweloperski (http://localhost:5173)
npm run build     # produkcyjny build do katalogu dist/
npm run preview   # podgląd zbudowanej wersji
```

## Struktura projektu

```
index.html               # punkt wejścia Vite (fonty + <div id="root">)
vite.config.js           # konfiguracja Vite + @vitejs/plugin-react
src/
  main.jsx               # bootstrap Reacta (createRoot + ErrorBoundary)
  App.jsx                # główny kontener, routing ekranów, pętle odświeżania
  styles/app.css         # motyw „Baltic Dawn" + wszystkie style
  core/
    store.js             # trwały storage (localStorage z fallbackiem w pamięci)
    net.js               # warstwa sieci: proxy CORS, cache, dedup, timeouty
    bus.js               # prosta magistrala zdarzeń (toasty)
  data/
    yahoo.js             # Yahoo Finance (świece + metadane)
    stooq.js             # Stooq CSV (zapasowe świece dzienne)
    capital.js           # Capital.com REST + WebSocket (realtime LIVE)
    paper.js             # rozliczanie wirtualnych pozycji po żywej cenie
    feed.js              # orkiestracja źródeł, wyszukiwanie, quotes, HTF
  indicators/index.js    # EMA/SMA/RSI/ATR/MACD/Bollinger/Stoch/ADX/OBV/VWAP, S/R
  patterns/index.js      # formacje świecowe + geometryczne (zigzag, trendy)
  smc/index.js           # market structure, BOS/CHOCH, FVG, OB, sweep, RR
  signals/engine.js      # silnik sygnałów (confluence) + skaner tła
  ai/index.js            # budowa kontekstu i zapytań do Claude / Gemini
  backtest/engine.js     # silnik backtestu na danych historycznych
  constants/
    instruments.js       # koszty/spready instrumentów
    defaults.js          # domyślne preferencje i konfiguracja SMC
  utils/
    format.js            # formatowanie cen, procentów, czasu, skala osi
    sessions.js          # sesje giełdowe (czas lokalny)
    notify.js            # dźwięk (beep) i powiadomienia systemowe
  components/
    ChartCanvas.jsx      # silnik wykresu (canvas): świece, EMA, panele, markery
    MiniLiveChart.jsx    # miniwykres pozycji na żywo
    EquityLine.jsx       # krzywa kapitału
    Sparkline.jsx        # miniwykres w liście obserwowanych
    SearchModal.jsx      # wyszukiwarka instrumentów
    icons.jsx            # zestaw ikon SVG
  screens/
    WatchlistScreen.jsx  # lista obserwowanych
    ChartScreen.jsx      # ekran wykresu + sygnał + AI + wejście w pozycję
    JournalScreen.jsx    # dziennik transakcji + statystyki
    InfoScreen.jsx       # ustawienia (źródło danych, SMC, API, itp.)
```

## Architektura

- **Warstwa danych** (`core`, `data`) pobiera notowania z wielu źródeł z
  automatycznym failoverem (bezpośredni fetch → publiczne proxy CORS → cache),
  a przy skonfigurowanym Capital.com korzysta z realtime po WebSocket.
- **Warstwa analityczna** (`indicators`, `patterns`, `smc`, `signals`) to czyste
  funkcje bez zależności od UI — te same obliczenia napędzają wykres i skaner
  działający w tle.
- **Warstwa UI** (`components`, `screens`, `App.jsx`) to React; ciężki rendering
  wykresu odbywa się na `<canvas>` dla płynności na urządzeniach mobilnych.

## Aplikacja na Androida (APK)

Projekt jest spakowany jako natywna aplikacja Androida przez **Capacitor** —
z natywnym HTTP (`CapacitorHttp`), który omija ograniczenia CORS i daje
stabilne notowania na telefonie. Ma własną **ikonę**, nazwę **Rikipo Trader**
oraz **stały podpis** (keystore), dzięki któremu kolejne wersje instalują się
„na wierzch" bez odinstalowywania. Natywny projekt Androida jest w repozytorium
(katalog `android/`).

### Najprościej: gotowy APK z GitHub Actions (bez komputera)

Po każdym pushu na `main` workflow **Build Android APK** automatycznie buduje
podpisany plik `.apk` (z rosnącym `versionCode` = numer builda):

1. Otwórz **Releases → „Rikipo Trader — APK (latest)"** i pobierz
   `rikipo-trader.apk` (bezpośredni link), **lub**
2. **Actions → ostatni przebieg → Artifacts → `rikipo-trader-apk`**.
3. Otwórz plik na telefonie i zainstaluj (zezwól na „instalację z nieznanych
   źródeł" dla przeglądarki/menedżera plików).

Build można też odpalić ręcznie: **Actions → Build Android APK → Run workflow**.

### Build lokalny (Android Studio)

Wymaga Android Studio + JDK 17 + Android SDK 34.

```bash
npm install
npm run build
npx cap sync android     # kopiuje web build do projektu natywnego
npx cap open android     # otwiera projekt w Android Studio → Build APK
```

### Ikona aplikacji

Ikony launchera (`android/app/src/main/res/mipmap-*`) generowane są ze źródła
w `brand/` skryptem, bez zależności od chmury. Podgląd: `brand/icon-1024.png`.

### Podpisywanie (keystore)

APK podpisywany jest kluczem z `android/app/rikipo-release.keystore`
(dane w `android/app/keystore.properties`). Klucz jest w repozytorium celowo —
to prywatna, sideloadowana aplikacja (nie w sklepie Play), a stały podpis jest
tym, co pozwala instalować aktualizacje na istniejącą wersję. Jeśli chcesz go
utrzymać prywatnie, przenieś wartości do **GitHub Secrets** i pozwól workflow
zapisać `keystore.properties` w trakcie builda.

## Uwaga o notowaniach

Wersja webowa korzysta z publicznych proxy CORS do pobierania danych z Yahoo —
bywają przeciążone. Pełną stabilność (natywny HTTP, brak CORS) daje kompilacja do
APK przez Capacitor lub skonfigurowanie Capital.com w ustawieniach.
