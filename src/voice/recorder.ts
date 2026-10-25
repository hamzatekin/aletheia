import { mixDown, WAV_RATE, wavBytes } from './wav';

/** A recording in progress. */
export interface Recording {
  /** Stop and hand back what was recorded. */
  stop(): Promise<Blob>;
  /** Stop and throw it away. */
  cancel(): void;
}

export type StartRecording = () => Promise<Recording>;

/** Whether this browser can record from the microphone at all. */
export const canRecord = (): boolean => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Start recording from the microphone (asks for permission the first time). */
export const startRecording: StartRecording = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  recorder.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: recorder.mimeType }));
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = release;
      if (recorder.state !== 'inactive') recorder.stop();
      else release();
    },
  };
};

/** A recording as base64 WAV, mono at 16 kHz: a format Whisper always reads, whatever the browser recorded in. */
export async function toBase64Wav(blob: Blob): Promise<string> {
  // Decoding in a 16 kHz context resamples too.
  const audio = await new OfflineAudioContext(1, 1, WAV_RATE).decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  const wav = new Blob([wavBytes(mixDown(channels), audio.sampleRate) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the recording'));
    reader.readAsDataURL(wav);
  });
}
