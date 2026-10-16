// audio/wav.ts — propriétaire : audio-dev. Encodage WAV PCM 16 bits (export de la preview).

/** canaux Float32 [-1, 1] → Blob audio/wav (valeurs hors bornes écrêtées) */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Blob {
  const nCh = Math.max(1, channels.length);
  const len = channels[0]?.length ?? 0;
  const dataBytes = len * nCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nCh * 2, true);
  v.setUint16(32, nCh * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
