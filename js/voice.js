// Voice message recording. Records locally, hands the caller a plain Blob —
// encryption happens the same way any other attachment does, in
// js/crypto/attachmentCrypto.js, so voice messages get the identical E2E
// guarantee as photos/files.

// Safari doesn't support audio/webm for MediaRecorder — pick whatever this
// browser actually supports rather than hardcoding one format.
function pickMimeType() {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function isVoiceRecordingSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export function createRecorder() {
  let mediaRecorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    startedAt = Date.now();
    mediaRecorder.start();
  }

  // Resolves with null if the recording was too short to be worth sending
  // (e.g. an accidental tap) rather than a file/message for one blip of audio.
  function stop() {
    return new Promise((resolve) => {
      if (!mediaRecorder) return resolve(null);
      mediaRecorder.addEventListener(
        'stop',
        () => {
          stream.getTracks().forEach((track) => track.stop());
          const durationMs = Date.now() - startedAt;
          if (durationMs < 500 || chunks.length === 0) {
            resolve(null);
            return;
          }
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
          resolve({ blob, durationMs });
        },
        { once: true }
      );
      mediaRecorder.stop();
    });
  }

  function cancel() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (stream) stream.getTracks().forEach((track) => track.stop());
  }

  return { start, stop, cancel };
}
