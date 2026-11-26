/**
 * Voice questions are sent as 16 kHz mono 16-bit WAV: every speech service accepts it, unlike the WebM/MP4 that
 * MediaRecorder produces (which differs by browser). Recording uses MediaRecorder; conversion happens on the device.
 */
export const SAMPLE_RATE = 16_000;
export const MAX_SECONDS = 45;

/** PCM float samples → WAV bytes (exported for tests). */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Any recorded audio → 16 kHz mono WAV, resampled with an OfflineAudioContext. */
export async function toWav(recorded: Blob): Promise<Blob> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await recorded.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const out = await offline.startRendering();
    return new Blob([encodeWav(out.getChannelData(0))], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

export const canRecord = () =>
  typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

/** Starts recording; call stop() to get the WAV. Stops on its own after MAX_SECONDS. */
export async function startRecording(onAutoStop: () => void): Promise<{ stop: () => Promise<Blob>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" })); });
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const timer = window.setTimeout(onAutoStop, MAX_SECONDS * 1000);
  rec.start();
  return {
    stop: async () => { window.clearTimeout(timer); if (rec.state !== "inactive") rec.stop(); const blob = await done; release(); return toWav(blob); },
    cancel: () => { window.clearTimeout(timer); if (rec.state !== "inactive") rec.stop(); release(); },
  };
}
