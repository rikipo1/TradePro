export function beep(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    const actx = new AC();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.12, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.35);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.36);
    setTimeout(() => { try{ actx.close(); }catch(e){} }, 600);
  }catch(e){}
}
export async function notifyUser(title, body){
  let ok = false;
  try{
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if(LN){
      try{ await LN.requestPermissions(); }catch(e){}
      notifyUser._id = ((notifyUser._id || 0) + 1) % 2000000;
      await LN.schedule({ notifications:[{ id: notifyUser._id + 1, title, body }] });
      ok = true;
    }
  }catch(e){}
  if(!ok){
    try{
      if(typeof Notification !== 'undefined'){
        if(Notification.permission === 'granted'){ new Notification(title, { body }); ok = true; }
        else if(Notification.permission !== 'denied'){
          const p = await Notification.requestPermission();
          if(p === 'granted'){ new Notification(title, { body }); ok = true; }
        }
      }
    }catch(e){}
  }
  try{ if(navigator.vibrate) navigator.vibrate([170, 80, 170]); }catch(e){}
  beep();
  return ok;
}

/* ========================== FORMATOWANIE ============================= */
