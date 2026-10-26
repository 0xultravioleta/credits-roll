export interface AudioChunk {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  language?: 'en' | 'es';
}

export interface Transcriber {
  transcribe(chunk: AudioChunk): Promise<string>;
}

export interface Embeddings {
  embed(texts: string[]): Promise<number[][]>;
}
