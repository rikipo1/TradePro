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

## Uwaga o notowaniach

Wersja webowa korzysta z publicznych proxy CORS do pobierania danych z Yahoo —
bywają przeciążone. Pełną stabilność (natywny HTTP, brak CORS) daje kompilacja do
APK przez Capacitor lub skonfigurowanie Capital.com w ustawieniach.
