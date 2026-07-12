# Rikipo Trader

Prywatne narzędzie **analityczno-edukacyjne** do analizy rynków (indeksy, forex,
złoto, krypto). Notowania z Yahoo Finance / Stooq oraz opcjonalnie **realtime
LIVE z Capital.com**. Silnik wskaźników, detektor formacji świecowych i
geometrycznych, analiza **Smart Money Concepts (SMC)**, silnik sygnałów
(confluence), analiza AI (Claude / Gemini), backtest oraz dziennik transakcji
(paper trading).

> ⚠️ Aplikacja nie stanowi porady inwestycyjnej. Handel CFD wiąże się z wysokim
> ryzykiem utraty kapitału.

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
npm test          # testy jednostkowe logiki finansowej (Vitest)
```

## Model per-instrument / TF

Model prawdopodobieństwa P(win) (wagi regresji logistycznej + kalibracja isotonic
+ historia kNN) jest trenowany i przechowywany **osobno dla każdej pary
instrument × interwał**. Klucze w `localStorage` są namespace'owane
(`rt_weights_<sym>_<tf>`, `rt_calib_…`, `rt_knn_…`, `rt_meta_…`) — trening na
DAX·M5 nie wpływa na EUR/USD·H1 ani na DAX·H1.

- **Brak modelu dla danej pary → `DEFAULT_WEIGHTS`** (rozsądne priory), bez
  kalibracji i bez kNN. Nigdy nie używamy modelu innej pary.
- **Wagi wyuczone wchodzą do toru decyzyjnego dopiero, gdy model jest
  „wiarygodny"** (patrz niżej). Do tego czasu — nawet po treningu — używane są
  wagi domyślne, a UI pokazuje `score (niekalibrowany)` zamiast `P(win) xx%`.
- Sizing: **fixed-fractional 0,5%** dopóki model nie jest wiarygodny; Kelly
  ćwierć dopiero przy skalibrowanym, wiarygodnym modelu.
- **Migracja:** stare GLOBALNE klucze (`rt_model_*`) są jednorazowo usuwane
  (dane użytkownika — dziennik, watchlista — nienaruszone), z komunikatem
  „Zresetowano stary globalny model — wytrenuj per instrument/TF".

> Po aktualizacji **przetrenuj model osobno dla każdej pary sym × TF** — stare
> globalne wagi zostały zresetowane.

## Walidacja k-fold (purged walk-forward)

Trening wag („🧠 Trenuj wagi") używa **K-fold purged walk-forward** (domyślnie
K = 5) zamiast pojedynczego splitu 60/40:

- oś czasu dzielona na K+1 bloków; dla foldu *k* trenujemy na blokach `[0..k]`,
  testujemy na bloku `k+1`;
- **embargo** (do treningu tylko próbki zamknięte przed startem testu) +
  **purging** (López de Prado — usuwamy próbki, których okno nachodzi na okno
  testowe);
- raportujemy **medianę i IQR** (avgR, PF, win%, Brier) oraz **łączny n_oos**;
- **wiarygodność** = `n_oos ≥ 100` **oraz** `mediana avgR > 0` **oraz**
  `75-percentyl Brier < 0.25`. Tylko wtedy włączają się wyuczone wagi,
  kalibracja i kNN;
- wagi **produkcyjne** trenowane są osobno na całości danych (z opcjonalnym
  buforem między-sesyjnym `rt_samples_*`), a metryki pochodzą wyłącznie z OOS
  k-fold — nie mylimy wag produkcyjnych z walidacją.

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
