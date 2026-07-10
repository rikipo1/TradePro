import React, { useState, useRef } from 'react';
import { DEFAULT_SMC } from '../constants/defaults.js';
import { Bus } from '../core/bus.js';
import { Net } from '../core/net.js';
import { Store } from '../core/store.js';
import { CapCfg, CapDbg, CapSess, capSession, capitalTick } from '../data/capital.js';
import { fmtPrice } from '../utils/format.js';

export function InfoScreen({ prefs, setPrefs, ai, setAi, cap, setCap, wl, setWl, journal, setJournal }){
  const [capTest, setCapTest] = useState({ busy:false, msg:'', ok:null });
  const [backupMsg, setBackupMsg] = useState('');
  const [backupText, setBackupText] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const fileInputRef = useRef(null);
  const applyBackup = (raw) => {
    try{
      const d = JSON.parse(String(raw || ''));
      if(!d || d.__app !== 'RikipoTrader'){ setBackupMsg('✗ To nie jest kopia Rikipo Trader (zły format).'); return false; }
      let restored = [];
      if(d.ai && typeof d.ai === 'object'){ setAi(a => ({ ...a, ...d.ai })); restored.push('klucze AI'); }
      if(d.cap && typeof d.cap === 'object'){ setCap(c => ({ ...c, ...d.cap })); restored.push('Capital.com'); }
      if(d.prefs && typeof d.prefs === 'object'){ setPrefs(p => ({ ...p, ...d.prefs, emaVis:{ ...p.emaVis, ...(d.prefs.emaVis || {}) }, ind:{ ...p.ind, ...(d.prefs.ind || {}) }, smc:{ ...DEFAULT_SMC, ...(p.smc||{}), ...(d.prefs.smc || {}) } })); restored.push('ustawienia'); }
      if(Array.isArray(d.wl) && d.wl.length){ setWl(() => d.wl); restored.push('lista (' + d.wl.length + ')'); }
      if(Array.isArray(d.journal)){ setJournal(() => d.journal); restored.push('dziennik (' + d.journal.length + ')'); }
      setBackupMsg('✓ Wczytano: ' + (restored.join(', ') || 'brak danych') + '. Data kopii: ' + (d.__ts ? String(d.__ts).slice(0,16).replace('T',' ') : '—'));
      Bus.show('📂 Kopia wczytana — ' + restored.join(', '));
      setPasteMode(false); setPasteText('');
      return true;
    }catch(err){
      setBackupMsg('✗ Nie udało się odczytać kopii: ' + (err.message || err));
      return false;
    }
  };
  const phases = [
    { n:1, t:'Dane i wykres — świece, EMA 9/20/50/200, wolumen, watchlista', s:'b-done', l:'GOTOWE' },
    { n:2, t:'Pełne wskaźniki — RSI, MACD, VWAP, ATR, Bollinger, Stochastic, ADX, OBV + strefy S/R', s:'b-done', l:'GOTOWE' },
    { n:3, t:'Detektor formacji — 30 świecowych + geometryczne na pivotach ZigZag', s:'b-done', l:'GOTOWE' },
    { n:4, t:'Silnik sygnałów — confluence, entry / SL / TP z ATR, filtr min 1:1.5 RR', s:'b-done', l:'GOTOWE' },
    { n:5, t:'AI + news — Claude / Gemini, sentyment, walidacja sygnału', s:'b-done', l:'GOTOWE' },
    { n:6, t:'Alerty push, dziennik transakcji, backtest na historii', s:'b-done', l:'GOTOWE' },
  ];
  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand">RIKIPO<em>TRADER</em><small>informacje i status</small></div>
      </div>

      <div className="card">
        <h3>Status systemu</h3>
        <div className="kv"><b>Środowisko</b><span>{Net.native ? 'Aplikacja natywna (APK)' : 'Przeglądarka / podgląd'}</span></div>
        <div className="kv"><b>Natywny HTTP</b><span style={{color: Net.plugin ? 'var(--up)' : 'var(--dim)'}}>{Net.plugin ? 'CapacitorHttp aktywny' : 'brak — fetch / proxy'}</span></div>
        <div className="kv"><b>Ostatni kanał danych</b><span className="mono">{Net.last}</span></div>
        <div className="kv"><b>Pamięć ustawień</b><span style={{color: Store.persistent ? 'var(--up)' : 'var(--accent)'}}>{Store.persistent ? 'trwała (localStorage)' : 'tylko na czas sesji'}</span></div>
      </div>

      <div className="card" style={{borderColor:'rgba(79,216,255,.3)'}}>
        <h3 style={{color:'var(--cyan)'}}>Alerty i skaner</h3>
        <div style={{display:'flex', gap:8, marginBottom:12, flexWrap:'wrap'}}>
          <button className={'chip mono' + (prefs.onlyStrong ? ' sel' : ' off')}
            style={prefs.onlyStrong ? {color:'var(--up)', borderColor:'rgba(47,214,174,.4)'} : null}
            onClick={() => setPrefs(p => {
              const nv = !p.onlyStrong;
              Bus.show(nv ? 'Alerty: tylko MOCNE sygnały (★ score ≥ 55)' : 'Alerty: wszystkie sygnały powyżej progu');
              return { ...p, onlyStrong:nv };
            })}>{prefs.onlyStrong ? '★ TYLKO MOCNE' : '○ Tylko mocne'}</button>
          <button className={'chip mono' + (prefs.bgScan ? ' sel' : ' off')}
            style={prefs.bgScan ? {color:'var(--up)', borderColor:'rgba(47,214,174,.4)'} : null}
            onClick={() => setPrefs(p => {
              const nv = !p.bgScan; const np = { ...p, bgScan:nv };
              if(nv && !p.alert) np.alert = true;
              Bus.show(nv ? '🛰️ Skaner tła WŁĄCZONY (cała lista, TF ' + (p.tf || 'M5') + ')' : 'Skaner tła wyłączony');
              return np;
            })}>{prefs.bgScan ? '🛰️ SKANER TŁA' : '○ Skaner tła'}</button>
          <button className={'chip mono' + (prefs.waitPullback ? ' sel' : ' off')}
            style={prefs.waitPullback ? {color:'var(--up)', borderColor:'rgba(47,214,174,.4)'} : null}
            onClick={() => setPrefs(p => {
              const nv = !p.waitPullback;
              Bus.show(nv ? '⏳ Czekaj na cofnięcie: gonione wejścia nie alarmują (chyba że ★ mocne)' : 'Alarmuję też wejścia „w biegu" (z etykietą jakości)');
              return { ...p, waitPullback:nv };
            })}>{prefs.waitPullback ? '⏳ CZEKAJ NA COFNIĘCIE' : '○ Czekaj na cofnięcie'}</button>
          <button className={'chip mono' + ((prefs.pbAlert !== false) ? ' sel' : ' off')}
            style={(prefs.pbAlert !== false) ? {color:'var(--ema9)', borderColor:'rgba(255,201,77,.45)'} : null}
            onClick={() => setPrefs(p => {
              const nv = !(p.pbAlert !== false);
              Bus.show(nv ? '🎯 Alert korekty: powiadomię, gdy cena zbliża się do strefy wejścia po cofnięciu' : 'Alert korekty wyłączony');
              return { ...p, pbAlert:nv };
            })}>{(prefs.pbAlert !== false) ? '🎯 ALERT KOREKTY' : '○ Alert korekty'}</button>
        </div>
        <div style={{fontSize:11.5, color:'var(--dim2)', marginBottom:6}}>
          Minimalny score wejścia: <b className="mono" style={{color:'var(--text)'}}>±{prefs.minScore != null ? prefs.minScore : 30}</b>
          <span style={{color:'var(--dim2)'}}> (w konsolidacji automatycznie +15)</span>
        </div>
        <input type="range" min="20" max="55" step="5" value={prefs.minScore != null ? prefs.minScore : 30}
          style={{width:'100%', accentColor:'var(--cyan)'}}
          onChange={e => { const val = parseInt(e.target.value, 10); setPrefs(p => ({ ...p, minScore: val })); }} />
        <div style={{display:'flex', justifyContent:'space-between', fontSize:10.5, color:'var(--dim2)', marginTop:2}}>
          <span>20 · więcej sygnałów</span><span>55 · tylko najpewniejsze</span>
        </div>
        <div style={{fontSize:12.5, color:'var(--dim)', lineHeight:1.75, marginTop:10}}>
          <b style={{color:'var(--text)'}}>Skaner tła</b> przechodzi całą listę obserwowanych na wybranym
          interwale co ~45 s i alarmuje o nowych sygnałach nawet bez otwartego wykresu
          (per instrument: dedup + cooldown 5 min). Pełna niezawodność w tle tylko w APK —
          w przeglądarce system usypia karty. <b style={{color:'var(--text)'}}>Tylko mocne</b> ogranicza
          alerty do sygnałów ★ (score ≥ 55) i działa też na ekranie wykresu.
          <br/><br/><b style={{color:'var(--text)'}}>Jakość wejścia</b>: przy każdym sygnale apka mierzy,
          jak daleko cena odjechała od najbliższej kotwicy (EMA20 / strefa S/R / VWAP).
          „Przy strefie" (≤0.6×ATR) = świeże wejście z ciasnym SL — dostaje plus do score.
          „Gonienie ruchu" (&gt;1.3×ATR) = cena już uciekła — score jest karany i pojawia się
          ostrzeżenie. <b style={{color:'var(--text)'}}>Czekaj na cofnięcie</b> całkiem wycisza alerty
          o gonionych wejściach (poza sygnałami ★), żebyś wchodził dopiero na pullbacku do strefy.
          <br/><br/><b style={{color:'var(--ema9)'}}>🎯 Alert korekty</b>: gdy trend trwa, ale cena jest już
          przewyciągnięta (gonienie / wykupienie / premium), apka wylicza <b style={{color:'var(--text)'}}>strefę
          najlepszego wejścia po cofnięciu</b> — zbieg poziomów (Fibonacci nogi impulsu, EMA20/50, Order Block,
          FVG, wsparcie/opór, równowaga 50%, VWAP) — z pewnością, celem, RR i unieważnieniem. Strefa rysuje się
          na wykresie (żółte linie „PB"), a gdy cena się do niej zbliża (a potem w nią wchodzi) — dostajesz
          powiadomienie, żeby czekać na potwierdzenie reakcji.
        </div>
      </div>

      <div className="card">
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
          <h3 style={{margin:0}}>Strojenie SMC (progi silnika)</h3>
          <span className="spacer" style={{flex:1}} />
          <button className="chip mono" style={{fontSize:11, padding:'5px 9px', color:'var(--accent)', borderColor:'rgba(255,138,117,.4)'}}
            onClick={() => {
              setPrefs(p => ({ ...p, smc:{ ...DEFAULT_SMC } }));
              Bus.show('↺ Progi SMC przywrócone do wartości domyślnych');
            }}>↺ Reset do domyślnych</button>
        </div>
        <div style={{fontSize:12, color:'var(--dim)', lineHeight:1.6, marginBottom:10}}>
          Domyślne wartości są rozsądnym startem — dostrój je własnym backtestem na realnych
          danych DAX/US100. Zmiany działają natychmiast na wykresie, w skanerze i w backteście.
        </div>
        {(() => {
          const smc = prefs.smc || DEFAULT_SMC;
          const setSmc = (k, v) => setPrefs(p => ({ ...p, smc:{ ...DEFAULT_SMC, ...(p.smc||{}), [k]:v } }));
          const rows = [
            ['premium', 'Próg PREMIUM (short powyżej %)', 55, 80, 1, '%', 'Powyżej tego % zakresu cena jest „droga" — preferowane shorty'],
            ['discount', 'Próg DISCOUNT (long poniżej %)', 20, 45, 1, '%', 'Poniżej tego % cena jest „tania" — preferowane longi'],
            ['dispImpulse', 'Displacement: siła świecy (×ATR)', 0.8, 2.0, 0.1, '×', 'Body świecy / ATR, by uznać ją za impuls instytucjonalny'],
            ['dispBody', 'Displacement: udział body', 0.4, 0.85, 0.05, '', 'Jaka część zakresu świecy to korpus (reszta to knoty)'],
            ['fvgDist', 'Zasięg FVG od ceny (×ATR)', 0.2, 1.2, 0.1, '×', 'Jak blisko musi być luka FVG, by liczyła się do oceny'],
            ['strong', 'Próg „mocny sygnał" ★', 45, 75, 1, '', 'Score ≥ tego gra kontrę HTF i omija słaby filtr sesji'],
            ['rangeBonus', 'Kara progu w konsolidacji', 0, 30, 1, 'pkt', 'Ile dodać do progu wejścia, gdy rynek w range (ADX niski)'],
            ['minRR', 'Minimalny RR do struktury', 1.0, 3.0, 0.1, ':1', 'Poniżej tego RR do najbliższej struktury setup jest odrzucany'],
          ];
          return rows.map(([k, lbl, min, max, step, unit, hint]) => {
            const val = smc[k] != null ? smc[k] : DEFAULT_SMC[k];
            const isDef = Math.abs(val - DEFAULT_SMC[k]) < 1e-9;
            return (
              <div key={k} style={{marginBottom:12}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', fontSize:12.5}}>
                  <span style={{color:'var(--dim)'}}>{lbl}</span>
                  <b className="mono" style={{color: isDef ? 'var(--dim)' : 'var(--cyan)'}}>
                    {step < 1 ? val.toFixed(step < 0.1 ? 2 : (Number.isInteger(val*10)?1:2)) : val}{unit}
                    {!isDef && <span style={{color:'var(--dim2)', fontWeight:400}}> (dom. {DEFAULT_SMC[k]}{unit})</span>}
                  </b>
                </div>
                <input type="range" min={min} max={max} step={step} value={val}
                  style={{width:'100%', accentColor: isDef ? 'var(--dim)' : 'var(--cyan)'}}
                  onChange={e => setSmc(k, parseFloat(e.target.value))} />
                <div style={{fontSize:10.5, color:'var(--dim2)', lineHeight:1.4}}>{hint}</div>
              </div>
            );
          });
        })()}
      </div>

      <div className="card" style={{borderColor:'rgba(255,138,117,.35)'}}>
        <h3 style={{color:'var(--accent)'}}>Kopia zapasowa (klucze API + ustawienia)</h3>
        <div style={{display:'flex', gap:8, marginBottom:11, flexWrap:'wrap'}}>
          <button className="chip sel mono" style={{flex:1, justifyContent:'center', padding:'11px'}}
            onClick={async () => {
              try{
                const dump = {
                  __app:'RikipoTrader', __type:'backup', __ver:1, __ts:new Date().toISOString(),
                  ai, cap, prefs, wl, journal,
                };
                const json = JSON.stringify(dump, null, 2);
                const fname = 'rikipo-trader-backup-' + new Date().toISOString().slice(0,10) + '.json';
                const Cap = window.Capacitor && window.Capacitor.Plugins;
                const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

                /* --- APK: zapisz do CACHE (pewny, bez uprawnień) i OD RAZU otwórz
                   Udostępnianie — tam sam wybierzesz Dysk / Pliki / Gmail / WhatsApp.
                   To jedyny sposób, by plik realnie trafił w widoczne miejsce. --- */
                if(isNative && Cap && Cap.Filesystem){
                  let uri = null;
                  try{
                    const res = await Cap.Filesystem.writeFile({
                      path: fname, data: json, directory:'CACHE', encoding:'utf8', recursive:true,
                    });
                    uri = res && res.uri ? res.uri : null;
                  }catch(e){
                    /* awaryjnie spróbuj katalogu danych apki */
                    try{
                      const res2 = await Cap.Filesystem.writeFile({
                        path: fname, data: json, directory:'DATA', encoding:'utf8', recursive:true,
                      });
                      uri = res2 && res2.uri ? res2.uri : null;
                    }catch(e2){ uri = null; }
                  }
                  if(uri && Cap.Share){
                    try{
                      await Cap.Share.share({ title:'Kopia Rikipo Trader', text:'Kopia zapasowa Rikipo Trader', url:uri, dialogTitle:'Zapisz / wyślij kopię' });
                      setBackupMsg('✓ Kopia gotowa: ' + fname + ' — wybierz gdzie ją zapisać (Dysk, Pliki, Gmail…). Trzymaj ten plik, by odzyskać klucze.');
                      Bus.show('💾 Wybierz miejsce zapisu kopii');
                      return;
                    }catch(eShare){ /* użytkownik zamknął okno lub brak Share → spadamy niżej */ }
                  }
                  if(uri){
                    setBackupMsg('✓ Zapisano w pamięci aplikacji: ' + fname + '. Aby wyjąć plik, użyj „Udostępnij" albo zainstaluj wtyczkę Share.');
                    Bus.show('💾 Kopia zapisana w aplikacji');
                    return;
                  }
                }

                /* --- Przeglądarka / brak wtyczek: pobranie, a gdy zawiedzie — schowek/ręcznie --- */
                let downloaded = false;
                try{
                  const blob = new Blob([json], { type:'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = fname; document.body.appendChild(a); a.click();
                  document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 4000);
                  downloaded = true;
                }catch(eDl){ downloaded = false; }

                /* w webview APK bez menedżera pobierania a.click() nic nie zapisuje —
                   zawsze udostępnij też tekst do schowka jako pewny plan B */
                let copied = false;
                try{
                  if(navigator.clipboard && navigator.clipboard.writeText){
                    await navigator.clipboard.writeText(json);
                    copied = true;
                  }
                }catch(eCp){ copied = false; }

                setBackupText(json);
                if(downloaded){
                  setBackupMsg('✓ Pobrano plik: ' + fname + ' (folder Pobrane)' + (copied ? ' — treść jest też w schowku.' : '.') + ' Trzymaj go, by odzyskać klucze przy reinstalacji.');
                } else if(copied){
                  setBackupMsg('✓ Kopia skopiowana do schowka (pobranie pliku niedostępne w tym widoku). Wklej ją w Notatniku i zapisz jako .json.');
                } else {
                  setBackupMsg('ℹ Zaznacz i skopiuj tekst poniżej, wklej w Notatniku i zapisz jako .json — to Twoja kopia zapasowa.');
                }
                Bus.show('💾 Kopia zapasowa gotowa');
              }catch(e){
                setBackupMsg('✗ Błąd zapisu: ' + (e.message || e));
              }
            }}>💾 Zapisz kopię</button>
          <button className="chip mono" style={{flex:1, justifyContent:'center', padding:'11px'}}
            onClick={() => { if(fileInputRef.current) fileInputRef.current.click(); }}>📂 Wczytaj z pliku</button>
          <button className="chip mono" style={{flex:1, justifyContent:'center', padding:'11px'}}
            onClick={() => setPasteMode(m => !m)}>📥 Wklej kopię</button>
        </div>
        {pasteMode ? (
          <div style={{marginBottom:10}}>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              placeholder="Wklej tu całą treść kopii (JSON zaczynający się od { „__app”: „RikipoTrader” … })"
              style={{width:'100%', minHeight:110, background:'var(--panel)', color:'var(--text)', border:'1px solid var(--border2)', borderRadius:10, padding:10, fontSize:11, fontFamily:"'JetBrains Mono',monospace", resize:'vertical', marginBottom:6}} />
            <div style={{display:'flex', gap:8}}>
              <button className="chip sel mono" style={{flex:1, justifyContent:'center', padding:'9px'}}
                onClick={() => { if(pasteText.trim()) applyBackup(pasteText.trim()); else setBackupMsg('✗ Najpierw wklej treść kopii.'); }}>✓ Przywróć z wklejonego</button>
              <button className="chip mono off" style={{padding:'9px 12px'}}
                onClick={() => { setPasteMode(false); setPasteText(''); }}>Anuluj</button>
            </div>
          </div>
        ) : null}
        <input ref={fileInputRef} type="file" accept="application/json,.json" style={{display:'none'}}
          onChange={e => {
            const f = e.target.files && e.target.files[0];
            if(!f) return;
            const reader = new FileReader();
            reader.onload = () => { applyBackup(String(reader.result || '')); };
            reader.onerror = () => setBackupMsg('✗ Błąd odczytu pliku.');
            reader.readAsText(f);
            e.target.value = '';
          }} />
        {backupMsg ? (
          <div style={{fontSize:12.5, lineHeight:1.6, marginBottom:8, color: backupMsg[0] === '✓' ? 'var(--up)' : backupMsg[0] === 'ℹ' ? 'var(--cyan)' : 'var(--down)'}}>{backupMsg}</div>
        ) : null}
        {backupText ? (
          <div style={{marginBottom:10}}>
            <div style={{display:'flex', gap:8, marginBottom:6}}>
              <button className="chip mono" style={{padding:'6px 10px', fontSize:11}}
                onClick={async () => {
                  try{
                    if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(backupText); Bus.show('✓ Skopiowano do schowka'); }
                    else throw new Error('no clipboard');
                  }catch(e){ Bus.show('Zaznacz tekst ręcznie i skopiuj'); }
                }}>📋 Kopiuj do schowka</button>
              <button className="chip mono off" style={{padding:'6px 10px', fontSize:11}}
                onClick={() => { setBackupText(''); }}>✕ Ukryj</button>
            </div>
            <textarea readOnly value={backupText}
              onFocus={e => e.target.select()}
              style={{width:'100%', minHeight:120, maxHeight:200, background:'var(--panel)', color:'var(--dim)', border:'1px solid var(--border2)', borderRadius:10, padding:10, fontSize:11, fontFamily:"'JetBrains Mono',monospace", resize:'vertical'}} />
            <div style={{fontSize:11, color:'var(--dim2)', marginTop:5, lineHeight:1.6}}>
              Zaznacz całość → skopiuj → wklej w Notatniku → zapisz jako plik <b style={{color:'var(--text)'}}>.json</b>.
              Później „Wczytaj kopię" go odczyta.
            </div>
          </div>
        ) : null}
        <div style={{fontSize:12.5, color:'var(--dim)', lineHeight:1.75}}>
          Zapisuje <b style={{color:'var(--text)'}}>wszystkie klucze API</b> (Claude, Gemini, Capital.com:
          klucz + e-mail + hasło), ustawienia, listę obserwowanych i dziennik.
          W APK otwiera okno <b style={{color:'var(--text)'}}>Udostępnij</b> — wybierz gdzie zapisać (Dysk, Pliki, Gmail…).
          W przeglądarce plik się pobiera. Gdyby to zawiodło, treść trafia do schowka i pokazuje się poniżej
          <b style={{color:'var(--text)'}}> do ręcznego skopiowania</b>. Przywracasz przez „Wczytaj z pliku"
          albo „Wklej kopię". <b style={{color:'var(--accent)'}}>Uwaga:</b> kopia zawiera hasła w czystej postaci —
          trzymaj ją w bezpiecznym miejscu.
        </div>
      </div>

      <div className="card">
        <h3>Roadmapa</h3>
        {phases.map(p => (
          <div className="phase" key={p.n}>
            <span className={'badge ' + p.s}>{p.l}</span>
            <span style={{color: p.s === 'b-plan' ? 'var(--dim)' : 'var(--text)'}}>Faza {p.n}. {p.t}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Wskaźniki (Faza 2)</h3>
        <div style={{fontSize:13, color:'var(--dim)', lineHeight:1.8}}>
          Nakładki na wykres: Bollinger 20/2σ, VWAP (sesyjny — wymaga wolumenu,
          interwały M1–H1) oraz strefy S/R z pivotów fraktalnych klastrowanych wg ATR —
          jasność strefy rośnie z liczbą odbić. Panele pod wykresem (maks. 2 naraz):
          RSI 14, MACD 12/26/9, Stochastic 14/3/3, ADX 14 z +DI/−DI, OBV, ATR 14.
          Tapnięcie świecy pokazuje w krzyżyku wartości wszystkich włączonych wskaźników.
        </div>
      </div>

      <div className="card">
        <h3>Backtest, dziennik, alerty (Faza 6)</h3>
        <div style={{fontSize:13, color:'var(--dim)', lineHeight:1.8}}>
          <b style={{color:'var(--text)'}}>⟲ TEST</b> na ekranie wykresu przepuszcza silnik
          sygnałów przez całą historię świeca po świecy (strefy S/R liczone przyczynowo,
          bez zaglądania w przyszłość) i pokazuje trafność, sumę R, profit factor,
          obsunięcie i krzywą kapitału. <b style={{color:'var(--text)'}}>Dziennik</b> (zakładka na dole)
          zbiera plany z sygnałów i ręczne wpisy — po zamknięciu pozycji tapnij wpis
          i wybierz wynik. Pozycje PAPER (▶ z sygnału, KUP/SPRZEDAJ na wykresie, robot 🤖) rozliczają się SAME po żywej cenie na SL/TP — z powiadomieniem i wpisem wyniku. Tapnij pozycję paper w dzienniku, by rozwinąć mini-wykres LIVE z liniami Entry/SL/TP i obserwować ją na bieżąco; po zamknięciu widać znacznik, gdzie i jak zakończyła się transakcja.
          <b style={{color:'var(--text)'}}> Dzwonek</b> obok AUTO włącza alerty przy nowym sygnale:
          w APK przez powiadomienia (plugin @capacitor/local-notifications, jeśli jest w pipeline),
          w Chrome przez Notification API, a zawsze dodatkowo toast + wibracja + dźwięk.
        </div>
      </div>

      <div className="card" style={{borderColor:'rgba(47,214,174,.3)'}}>
        <h3 style={{color:'var(--up)'}}>Dane LIVE — Capital.com</h3>
        <div style={{display:'flex', gap:8, marginBottom:11}}>
          <button className={'chip mono' + (cap.on ? ' sel' : ' off')}
            style={cap.on ? {color:'var(--up)', borderColor:'rgba(47,214,174,.4)'} : null}
            onClick={() => setCap(c => ({ ...c, on:!c.on }))}>{cap.on ? '● LIVE WŁĄCZONE' : '○ LIVE'}</button>
          <button className={'chip mono' + (cap.demo ? ' sel' : '')}
            onClick={() => setCap(c => ({ ...c, demo:!c.demo }))}>{cap.demo ? 'KONTO DEMO' : 'KONTO REALNE'}</button>
        </div>
        <button className="chip sel mono" style={{width:'100%', justifyContent:'center', padding:'11px', marginBottom:10, opacity: capTest.busy ? 0.6 : 1}}
          onClick={async () => {
            if(capTest.busy) return;
            if(!(cap.key && cap.id && cap.pass)){ setCapTest({ busy:false, ok:false, msg:'✗ Uzupełnij klucz, e-mail i hasło API poniżej.' }); return; }
            setCapTest({ busy:true, msg:'', ok:null });
            try{
              CapSess.cst = null; CapSess.at = 0; CapSess.acctSet = false;
              await capSession();
              const t = await capitalTick('^GDAXI');
              setCapTest({ busy:false, ok:true, msg:'✓ Połączono! DE40 = ' + (t ? fmtPrice(t.px) : '—') + ' na żywo · konto ' + (CapCfg.demo ? 'DEMO' : 'REALNE') + '. Włącz LIVE i wejdź na wykres.' });
            }catch(e){
              let m = e.message || 'błąd';
              if(!Net.plugin){
                m = 'PRZEGLĄDARKA (CORS blokuje Capital — LIVE działa tylko w APK). ' + m;
              }
              if(CapDbg.last){
                m += '  ||  RAW: ' + CapDbg.last.via + ' · status ' + CapDbg.last.status + ' · ' + CapDbg.last.url + ' · odp: ' + (CapDbg.last.body || '(pusta)');
              }
              setCapTest({ busy:false, ok:false, msg:'✗ ' + m });
            }
          }}>{capTest.busy ? 'Testuję połączenie…' : '⚡ Testuj połączenie LIVE'}</button>
        {capTest.msg ? (
          <div style={{fontSize:12.5, lineHeight:1.6, marginBottom:10, color: capTest.ok ? 'var(--up)' : 'var(--down)'}}>{capTest.msg}</div>
        ) : null}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5}}>
          <div style={{fontSize:11.5, color:'var(--dim2)'}}>Klucz API (X-CAP-API-KEY):</div>
          <button className="chip mono" style={{padding:'2px 8px', fontSize:10.5}}
            onClick={() => setShowKeys(s => !s)}>{showKeys ? '🙈 ukryj' : '👁 pokaż'}</button>
        </div>
        <div className="searchbox" style={{marginBottom:4}}>
          <input type={showKeys ? 'text' : 'password'} value={cap.key || ''} placeholder="klucz z Settings → API integrations" autoComplete="off"
            onChange={e => { const val = e.target.value; setCap(c => ({ ...c, key: val.trim() })); }}
            onBlur={() => { if(cap.key) Bus.show('✓ Klucz Capital.com zapisany na urządzeniu'); }} />
        </div>
        <div style={{fontSize:11, marginBottom:10, color: cap.key ? 'var(--up)' : 'var(--dim2)'}}>
          {cap.key ? '✓ zapisany (' + cap.key.length + ' znaków)' : 'brak'}
        </div>
        <div style={{fontSize:11.5, color:'var(--dim2)', marginBottom:5}}>E-mail konta (identifier):</div>
        <div className="searchbox" style={{marginBottom:10}}>
          <input value={cap.id || ''} placeholder="email@…" autoComplete="off"
            onChange={e => { const val = e.target.value; setCap(c => ({ ...c, id: val.trim() })); }} />
        </div>
        <div style={{fontSize:11.5, color:'var(--dim2)', marginBottom:5}}>Hasło API (ustalane przy tworzeniu klucza):</div>
        <div className="searchbox" style={{marginBottom:4}}>
          <input type={showKeys ? 'text' : 'password'} value={cap.pass || ''} placeholder="hasło klucza API" autoComplete="off"
            onChange={e => { const val = e.target.value; setCap(c => ({ ...c, pass: val })); }}
            onBlur={() => { if(cap.pass) Bus.show('✓ Hasło Capital.com zapisane na urządzeniu'); }} />
        </div>
        <div style={{fontSize:11, marginBottom:10, color: cap.pass ? 'var(--up)' : 'var(--dim2)'}}>
          {cap.pass ? '✓ zapisane' : 'brak'}
        </div>
        <div style={{fontSize:12.5, color:'var(--dim)', lineHeight:1.75}}>
          Po co: darmowe dane indeksów (Yahoo) mają ~15 min opóźnienia z licencji giełd.
          Capital.com to broker CFD z darmowym API — notowania DE40 / US30 / US500 / US100 /
          GOLD / EURUSD / BTC w czasie rzeczywistym, praktycznie identyczne z XTB.
          Jak włączyć: załóż darmowe konto na capital.com → Ustawienia → API integrations →
          Generate new key (ustal hasło API) → wpisz powyżej klucz, e-mail i hasło API → LIVE WŁĄCZONE.
          Wykres pobiera świece z Capital, a przy AUTO bieżąca świeca aktualizuje się
          <b style={{color:'var(--text)'}}> co 3 sekundy</b> — jak w xStation.
          Dane logowania zostają na urządzeniu i idą wyłącznie do Capital.com (nigdy przez proxy),
          dlatego LIVE działa w APK; w przeglądarce Chrome CORS zwykle to blokuje.
          Przy braku połączenia aplikacja sama wraca do Yahoo.
        </div>
      </div>

      <div className="card">
        <h3>Analiza AI (Faza 5)</h3>
        <div style={{display:'flex', gap:8, marginBottom:11}}>
          {[['claude','Claude'],['gemini','Gemini']].map(([v2, l]) => (
            <button key={v2} className={'chip mono' + ((ai.provider || 'claude') === v2 ? ' sel' : '')}
              onClick={() => setAi(a => ({ ...a, provider:v2 }))}>{l}</button>
          ))}
          <button className={'chip mono' + (ai.news ? ' sel' : ' off')}
            onClick={() => setAi(a => ({ ...a, news:!a.news }))}>NEWSY</button>
        </div>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5}}>
          <div style={{fontSize:11.5, color:'var(--dim2)'}}>Klucz Anthropic (Claude):</div>
          <button className="chip mono" style={{padding:'2px 8px', fontSize:10.5}}
            onClick={() => setShowKeys(s => !s)}>{showKeys ? '🙈 ukryj' : '👁 pokaż'}</button>
        </div>
        <div className="searchbox" style={{marginBottom:4}}>
          <input type={showKeys ? 'text' : 'password'} value={ai.keyClaude || ''} placeholder="sk-ant-…" autoComplete="off"
            onChange={e => { const val = e.target.value; setAi(a => ({ ...a, keyClaude: val.trim() })); }}
            onBlur={() => { if(ai.keyClaude) Bus.show('✓ Klucz Claude zapisany na urządzeniu'); }} />
        </div>
        <div style={{fontSize:11, marginBottom:10, color: ai.keyClaude ? 'var(--up)' : 'var(--dim2)'}}>
          {ai.keyClaude ? '✓ zapisany (' + ai.keyClaude.length + ' znaków)' : 'brak — wklej klucz, zapisze się automatycznie'}
        </div>
        <div style={{fontSize:11.5, color:'var(--dim2)', marginBottom:5}}>Klucz Google AI Studio (Gemini):</div>
        <div className="searchbox" style={{marginBottom:4}}>
          <input type={showKeys ? 'text' : 'password'} value={ai.keyGemini || ''} placeholder="AIza…" autoComplete="off"
            onChange={e => { const val = e.target.value; setAi(a => ({ ...a, keyGemini: val.trim() })); }}
            onBlur={() => { if(ai.keyGemini) Bus.show('✓ Klucz Gemini zapisany na urządzeniu'); }} />
        </div>
        <div style={{fontSize:11, marginBottom:10, color: ai.keyGemini ? 'var(--up)' : 'var(--dim2)'}}>
          {ai.keyGemini ? '✓ zapisany (' + ai.keyGemini.length + ' znaków)' : 'brak — wklej klucz, zapisze się automatycznie'}
        </div>
        {!Store.persistent && (
          <div style={{fontSize:12, color:'var(--accent)', background:'rgba(255,138,117,.10)', border:'1px solid rgba(255,138,117,.30)', borderRadius:10, padding:'8px 11px', marginBottom:10, lineHeight:1.6}}>
            ⚠ Pamięć trwała niedostępna w tym środowisku — klucze przetrwają tylko do zamknięcia aplikacji.
            Użyj „Kopia zapasowa" powyżej, aby zapisać je do pliku, albo uruchom wersję APK.
          </div>
        )}
        <div style={{fontSize:12.5, color:'var(--dim)', lineHeight:1.75}}>
          Przycisk <b style={{color:'var(--cyan)'}}>✦ AI</b> na ekranie wykresu wysyła do modelu
          komplet danych (świece, wskaźniki, S/R, formacje, sygnał silnika) i zwraca werdykt
          z pewnością, ryzykami i oceną poziomów. NEWSY = model sam wyszukuje świeże
          wiadomości o instrumencie (Claude: web search, Gemini: Google Search);
          gdy konto nie wspiera wyszukiwania, analiza wykona się automatycznie bez newsów.
          Klucze zostają na urządzeniu i idą wyłącznie bezpośrednio do Anthropic / Google —
          nigdy przez publiczne proxy. Koszt: ułamki centa za analizę.
        </div>
      </div>

      <div className="card">
        <h3>Silnik sygnałów (Faza 4)</h3>
        <div style={{fontSize:13, color:'var(--dim)', lineHeight:1.8}}>
          Pasek nad wykresem pokazuje confluence −100…+100 z 10 grup czynników:
          układ i nachylenie EMA, RSI, MACD, ADX z +DI/−DI, Stochastic, VWAP,
          Bollinger (w konsolidacji), świeże formacje, strefy S/R z wybiciami
          oraz wolumen. Sygnał LONG/SHORT od progu ustawianego w „Alerty i skaner"
          (domyślnie ±30, ★ mocny od ±55); wymaga zgody min. 2 z 3 filarów
          (struktura / momentum / kontekst) i trendu wyższego interwału.
          SL jest strukturalny — za najbliższą strefą S/R (0.7–2.2×ATR),
          TP1 = 1:1.5 RR, TP2 = 1:2.5. Wbudowane Twoje zasady: filtr minimalnego RR,
          ostrzeżenie gdy strefa blokuje TP1, tryb konsolidacji przy ADX &lt; 18
          i okna makro (14:30, 16:00, 20:00, otwarcia sesji). Poziomy rysują się
          na wykresie, a pełne uzasadnienie punkt po punkcie — po tapnięciu paska.
        </div>
      </div>

      <div className="card">
        <h3>Formacje (Faza 3)</h3>
        <div style={{fontSize:13, color:'var(--dim)', lineHeight:1.8}}>
          30 formacji świecowych (młot, objęcia, harami, gwiazdy, żołnierze, kruki,
          przenikanie, szczypce, marubozu, doji i inne) + formacje geometryczne
          na pivotach ZigZag (podwójne/potrójne szczyty i dna, RGR, trójkąty,
          kliny, kanały, flagi, chorągiewki). Każda ma confidence 0–100%
          liczone z kontekstu trendu, wielkości świec i wolumenu.
          Znaczniki ▲▼ na wykresie (przełącznik ZNACZNIKI), linie formacji
          geometrycznych rysowane automatycznie, pełna lista pod ≡ FORMACJE.
        </div>
      </div>

      <div className="card">
        <h3>Obsługa wykresu</h3>
        <div style={{fontSize:13, color:'var(--dim)', lineHeight:1.8}}>
          Przesuń palcem — przewijanie historii. Uszczypnij — zoom.
          Tapnij świecę — krzyżyk z OHLC i wartościami EMA (tapnij ponownie, by ukryć).
          Przycisk „⇥ Teraz" wraca do najnowszej świecy. Na komputerze: kółko myszy = zoom, dwuklik = reset.
        </div>
      </div>

      <div className="card">
        <h3>Dane</h3>
        <div style={{fontSize:13, color:'var(--dim)', lineHeight:1.8}}>
          Notowania: Yahoo Finance — uwaga: indeksy (DAX, Dow) mają tam ~15 minut opóźnienia z licencji giełdowych; akcje US, forex i krypto są niemal na bieżąco. Prawdziwy czas rzeczywisty daje LIVE przez Capital.com (karta wyżej).
          Indeksy kasowe DAX i Dow Jones odpowiadają instrumentom DE40 / US30 w XTB —
          różnice wynikają ze spreadu i kontraktu CFD.
          W Chrome dane idą przez publiczne proxy CORS, które mają limity zapytań —
          stąd możliwe chwilowe przerwy; aplikacja trzyma wtedy ostatnie notowania
          z pamięci podręcznej (do 10 min). Pełną stabilność daje wersja APK,
          gdzie dane pobiera natywny HTTP bez żadnych proxy. Dla interwału D1 działa też zapasowe źródło (Stooq), włączane automatycznie, gdy Yahoo nie odpowiada.
        </div>
      </div>

      <div className="card">
        <h3>Źródło danych</h3>
        <div style={{fontSize:12.5, color:'var(--dim)', lineHeight:1.7}}>
          Tylko realne notowania na żywo. Dane pobierane z Yahoo Finance,
          a przy włączonym LIVE strumień z Capital.com (WebSocket + poll 3s).
          Symulowane świece (DEMO) zostały usunięte.
          Pełną stabilność sieci daje aplikacja APK (natywny HTTP) lub plik otwarty w Chrome.
        </div>
      </div>

      <div className="card" style={{borderColor:'rgba(255,138,117,.25)'}}>
        <h3 style={{color:'var(--accent)'}}>Zastrzeżenie</h3>
        <div style={{fontSize:12.5, color:'var(--dim)', lineHeight:1.7}}>
          Rikipo Trader to prywatne narzędzie analityczno-edukacyjne.
          Nie stanowi porady inwestycyjnej. Handel CFD wiąże się z wysokim ryzykiem utraty kapitału.
        </div>
      </div>

      <div style={{textAlign:'center', padding:'10px 0 22px', fontSize:10.5, color:'var(--dim2)'}} className="mono">
        Rikipo Trader v1.3.3 · auto-epic + diag · motyw Baltic Dawn
      </div>
    </div>
  );
}
