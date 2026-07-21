# Wyniki ablacji [E2-1]

Data: 2026-07-13 · commit bazowy: c72b98c · dane: Yahoo Finance (żywe)

## Werdykt

**Reguła decyzyjna briefu (usunięcie elementu przy poprawie med(avgR) OOS na ≥2/3
instrumentów) NIE JEST WYKONYWALNA na dostępnych danych** — żadna konfiguracja na
żadnym instrumencie/TF nie osiągnęła progu 30 rozstrzygniętych etykiet (TP1/SL)
wymaganych do treningu wag, więc k-fold odmawia treningu ("za mało próbek").
Żaden element toru decyzyjnego nie został usunięty. To jest wynik, nie błąd:
system transakcyjny generuje ~1 wejście / 400 świec, a ~50–70% wyników to
BE/TIMEOUT (nieużywane jako etykiety zgodnie z K5).

## Wydajność etykiet na danych rzeczywistych (przebieg bazowy)

| instrument | TF | świece | transakcje | etykiety TP1/SL | rozkład |
|---|---|---|---|---|---|
| ^GDAXI | H1 (730d) | 6556 | 16 | 8 | SL 6 · TP1 2 · TIMEOUT 5 · BE 3 |
| ^GSPC | H1 (730d) | 5081 | 11 | 4 | SL 3 · TP1 1 · TIMEOUT 5 · BE 2 |
| EURUSD=X | H1 (730d) | 17219 | 42 | 14 | TIMEOUT 26 · SL 10 · TP1 4 · BE 2 |
| EURUSD=X | M5 (30d) | 8269 | 32 | 6 | (większość BE/TIMEOUT) |
| ^GDAXI | M15 (60d) | 2032 | 8 | 5 | SL 3 · TP1 2 · TIMEOUT 2 · BE 1 |

## Surowe tabele ablacji (7 konfiguracji × 3 instrumenty × M5/M15/H1)

```
=== ^GDAXI M5 30d ===
# Ablacja: ^GDAXI · M5 · 3061 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
=== ^GDAXI M15 60d ===
# Ablacja: ^GDAXI · M15 · 2032 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
=== ^GSPC M5 30d ===
# Ablacja: ^GSPC · M5 · 2341 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
=== ^GSPC M15 60d ===
# Ablacja: ^GSPC · M15 · 1561 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
=== EURUSD=X M5 30d ===
# Ablacja: EURUSD=X · M5 · 8269 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
=== EURUSD=X M15 60d ===
# Ablacja: EURUSD=X · M15 · 5579 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
=== ^GDAXI H1 730d ===
# Ablacja: ^GDAXI · H1 · 6556 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
=== ^GSPC H1 730d ===
# Ablacja: ^GSPC · H1 · 5081 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
=== EURUSD=X H1 730d ===
# Ablacja: EURUSD=X · H1 · 17218 świec
konfiguracja | n_oos        | medAvgR      | medPF        | medWin       | brierP75     | blad         
pełna        | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−liquidity   | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−location    | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−session     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−pillarGate  | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−htfGate     | 0            | —            | —            | —            | —            | za mało próbek (min 30)
−smc         | 0            | —            | —            | —            | —            | za mało próbek (min 30)
```

## Wnioski i dalsze kroki

1. Wąskim gardłem nie jest silnik ablacji, lecz PODAŻ ETYKIET: przy min. 30
   próbkach treningowych i 150 parach do kalibracji potrzeba ≥60 tys. świec
   (≈ 2 lata M5 ciągłych danych) — Yahoo daje 30–60 dni intraday.
2. Mechanizm __ablate jest przetestowany unit-testami i gotowy; harness
   (`node scripts/ablation.js SYMBOL TF RANGE` lub przycisk 🔬 w modalu
   backtestu) należy uruchomić ponownie po podłączeniu dłuższej historii
   (Capital.com / eksport CSV).
3. Do tego czasu obowiązuje pełny tor decyzyjny (bez usunięć) oraz
   DEFAULT_WEIGHTS + stały sizing (model nie może osiągnąć reliable —
   patrz zaostrzenie E2-2).
