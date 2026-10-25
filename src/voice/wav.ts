/** Whisper works at 16 kHz; recording at that rate keeps uploads small (32 kB a second). */
export const WAV_RATE = 16_000;

/** A 16-bit PCM WAV file of mono samples between -1 and 1. */
export function wavBytes(samples: Float32Array, rate: number = WAV_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // size of this chunk
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a sample
  view.setUint16(34, 16, true); // bits a sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const c = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
  });
  return bytes;
}

/** All channels averaged into one. */
export function mixDown(channels: readonly Float32Array[]): Float32Array {
  const [first] = channels;
  if (!first || channels.length === 1) return first ?? new Float32Array(0);
  const out = new Float32Array(first.length);
  for (const ch of channels) ch.forEach((s, i) => (out[i] = (out[i] ?? 0) + s / channels.length));
  return out;
}
