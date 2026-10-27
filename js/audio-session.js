// iPad Safari's audio session (v0.8.1). speech.js sets navigator.audioSession.type = 'playback' so voices still sound
// with the ringer on silent; while it stays 'playback', getUserMedia fails and the mic looks broken ("录不了音").
// Every recording path switches to 'play-and-record' right before asking for the mic and back to 'playback' after.
// No-ops where navigator.audioSession does not exist (older Safari, Node tests).
const session = () => { try { return (globalThis.navigator && globalThis.navigator.audioSession) || null; } catch (e) { return null; } };

export function forRecording() {
  const s = session();
  try { if (s && s.type !== 'play-and-record') s.type = 'play-and-record'; } catch (e) { /* not settable here */ }
}

export function forPlayback() {
  const s = session();
  try { if (s && s.type !== 'playback') s.type = 'playback'; } catch (e) { /* not settable here */ }
}

// v0.9.3 (Wei 10-27: 每次按住都弹“允许使用麦克风”): a home-screen app asks again whenever the last mic stream was
// stopped. So after she lets go the stream is kept KEEP_MS and handed to the next hold (问老师, 读出来); it really stops
// after that, when the app goes to the background, or when its track is no longer live. While it is kept the session
// stays 'play-and-record'.
export const KEEP_MS = 90000;
let kept = null, keptTimer = null;
const isLive = s => { try { return !!s && typeof s.getAudioTracks === 'function' && s.getAudioTracks().some(t => t.readyState === 'live' && !t.muted); } catch (e) { return false; } };
const stopAll = s => { try { for (const t of (s && s.getTracks ? s.getTracks() : [])) t.stop(); } catch (e) { /* gone */ } };

export function dropMic() {
  clearTimeout(keptTimer); keptTimer = null;
  const s = kept; kept = null;
  if (s) { stopAll(s); forPlayback(); }
}

// in place of stopping the tracks: keeps the kept stream a while, stops any other right away
export function releaseMic(stream) {
  if (!stream) return;
  if (stream === kept && isLive(stream)) {
    clearTimeout(keptTimer);
    keptTimer = setTimeout(dropMic, KEEP_MS);
    if (keptTimer && keptTimer.unref) keptTimer.unref();
    return;
  }
  if (stream === kept) kept = null;
  stopAll(stream);
  if (!kept) setTimeout(forPlayback, 0);
}

try {
  const d = globalThis.document;
  if (d && d.addEventListener) d.addEventListener('visibilitychange', () => { if (d.hidden) dropMic(); });
  if (globalThis.addEventListener) globalThis.addEventListener('pagehide', dropMic);
} catch (e) { /* no page here */ }

// getUserMedia with the session switched first; the kept stream when it is still live; one retry after a short wait
// when iOS still reports the mic busy
export function micGetter(raw) {
  if (!raw) return null;
  return async constraints => {
    if (kept && isLive(kept)) { clearTimeout(keptTimer); keptTimer = null; forRecording(); return kept; }
    if (kept) dropMic();
    forRecording();
    let s;
    try { s = await raw(constraints); } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      await new Promise(r => setTimeout(r, 250));
      forRecording();
      s = await raw(constraints);
    }
    if (isLive(s)) kept = s;
    return s;
  };
}
