import type { AudioChunk, Embeddings, Transcriber } from './interfaces.js';
import { object } from '../twitch/source.js';

export class OpenAIClient {
  constructor(
    private readonly apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI providers');
  }

  async post(path: string, body: FormData | Record<string, unknown>): Promise<unknown> {
    const multipart = body instanceof FormData;
    try {
      const response = await this.request(`https://api.openai.com/v1/${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
        },
        body: multipart ? body : JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Provider request failed');
      return await response.json();
    } catch {
      // Provider errors can contain submitted text or credentials. Never propagate them.
      throw new Error('OpenAI request failed');
    }
  }
}

export class OpenAITranscriber implements Transcriber {
  constructor(
    private readonly client: OpenAIClient,
    private readonly model = 'gpt-4o-mini-transcribe',
  ) {}

  async transcribe(chunk: AudioChunk): Promise<string> {
    if (!chunk.bytes.length || chunk.bytes.length > 25_000_000)
      throw new Error('Invalid audio chunk size');
    const form = new FormData();
    form.set('model', this.model);
    if (chunk.language) form.set('language', chunk.language);
    form.set(
      'file',
      new Blob([new Uint8Array(chunk.bytes)], { type: chunk.mimeType }),
      chunk.filename,
    );
    const result = object(await this.client.post('audio/transcriptions', form));
    if (typeof result.text !== 'string') throw new Error('Invalid transcription response');
    return result.text;
  }
}

export class OpenAIEmbeddings implements Embeddings {
  constructor(
    private readonly client: OpenAIClient,
    private readonly model = 'text-embedding-3-small',
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const result = object(
      await this.client.post('embeddings', {
        model: this.model,
        input: texts,
        encoding_format: 'float',
      }),
    );
    if (!Array.isArray(result.data) || result.data.length !== texts.length)
      throw new Error('Invalid embeddings response');
    const rows = result.data.map(object).sort((a, b) => Number(a.index) - Number(b.index));
    if (
      rows.some(
        (row, index) =>
          row.index !== index ||
          !Array.isArray(row.embedding) ||
          row.embedding.length === 0 ||
          row.embedding.some(
            (value: unknown) => typeof value !== 'number' || !Number.isFinite(value),
          ),
      )
    )
      throw new Error('Invalid embedding vector');
    const vectors = rows.map((row) => row.embedding as number[]);
    if (vectors.some((vector) => vector.length !== vectors[0]?.length))
      throw new Error('Inconsistent embedding dimensions');
    return vectors;
  }
}
