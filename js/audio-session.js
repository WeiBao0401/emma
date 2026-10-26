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

// getUserMedia with the session switched first; one retry after a short wait when iOS still reports the mic busy
export function micGetter(raw) {
  if (!raw) return null;
  return async constraints => {
    forRecording();
    try { return await raw(constraints); } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      await new Promise(r => setTimeout(r, 250));
      forRecording();
      return raw(constraints);
    }
  };
}
