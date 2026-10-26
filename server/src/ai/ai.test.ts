import { expect, test, vi } from 'vitest';
import { FakeEmbeddings, FakeTranscriber } from './fake.js';
import { OpenAIClient, OpenAIEmbeddings, OpenAITranscriber } from './openai.js';
import { createProviders } from './providers.js';
import { OpenAIJudge } from '../matcher/openai-judge.js';

test('fakes run deterministically without credentials', async () => {
  expect(createProviders({}).judge.constructor.name).toBe('FakeJudge');
  expect(() => createProviders({ JUDGE: 'openai' })).toThrow('OPENAI_API_KEY');
  const fake = new FakeEmbeddings();
  expect(await fake.embed(['red switch'])).toEqual(await fake.embed(['red switch']));
  expect(
    await new FakeTranscriber().transcribe({
      bytes: new TextEncoder().encode('Hello stream'),
      filename: 'synthetic.txt',
      mimeType: 'text/plain',
    }),
  ).toBe('Hello stream');
});

test('OpenAI JSON judge uses JSON mode and rejects invented ids and incomplete responses', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                moments: [
                  { messageId: 'chat', kind: 'idea', confidence: 0.9 },
                  { messageId: 'invented', kind: 'assist', confidence: 1 },
                ],
              }),
            },
          },
        ],
      }),
    ),
  );
  const judge = new OpenAIJudge(new OpenAIClient('synthetic-key', request));
  const transcript = {
    id: 'w',
    streamId: 's',
    startAt: 1000,
    endAt: 2000,
    text: "I'll cross the northern bridge",
  };
  const messages = [
    { id: 'chat', viewer: { id: 'v', login: 'viewer' }, text: 'northern bridge', sentAt: 900 },
    { id: 'second', viewer: { id: 'v', login: 'viewer' }, text: 'other', sentAt: 800 },
  ];
  expect(await judge.judge(transcript, messages)).toEqual([
    { messageId: 'chat', kind: 'idea', confidence: 0.9 },
  ]);
  const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
  expect(body.response_format).toEqual({ type: 'json_object' });
  expect(body.store).toBe(false);
  expect(body.messages[1].content).not.toContain('viewer');
  request.mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
    ),
  );
  expect(await judge.judge(transcript, messages)).toEqual([]);
});

test('transcription uploads a chunk without persisting it', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"text":"hello"}'));
  const transcriber = new OpenAITranscriber(new OpenAIClient('synthetic-key', request));
  expect(
    await transcriber.transcribe({
      bytes: new Uint8Array([1, 2]),
      filename: 'chunk.wav',
      mimeType: 'audio/wav',
    }),
  ).toBe('hello');
  expect(request.mock.calls[0]![1]?.body).toBeInstanceOf(FormData);
});

test('embedding adapter orders vectors and validates dimensions', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response('{"data":[{"index":1,"embedding":[0,1]},{"index":0,"embedding":[1,0]}]}'),
    );
  expect(
    await new OpenAIEmbeddings(new OpenAIClient('synthetic-key', request)).embed(['one', 'two']),
  ).toEqual([
    [1, 0],
    [0, 1],
  ]);
});

test('provider failures do not propagate keys or raw provider error text', async () => {
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic-key private chat'));
  await expect(new OpenAIClient('synthetic-key', request).post('embeddings', {})).rejects.toThrow(
    /^OpenAI request failed$/,
  );
});
