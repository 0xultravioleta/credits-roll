import type { AudioChunk, Embeddings, Transcriber } from './interfaces.js';
import { words } from '../matcher/judge.js';

// Synthetic demo chunks contain UTF-8 text, not recordings of real people.
export class FakeTranscriber implements Transcriber {
  async transcribe(chunk: AudioChunk): Promise<string> {
    return new TextDecoder().decode(chunk.bytes);
  }
}

export class FakeEmbeddings implements Embeddings {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector: number[] = Array.from({ length: 64 }, () => 0);
      for (const word of words(text)) {
        let hash = 2166136261;
        for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        const index = (hash >>> 0) % vector.length;
        vector[index] = (vector[index] ?? 0) + 1;
      }
      return vector;
    });
  }
}
