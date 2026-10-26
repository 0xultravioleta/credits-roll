import { FakeEmbeddings, FakeTranscriber } from './fake.js';
import { OpenAIClient, OpenAIEmbeddings, OpenAITranscriber } from './openai.js';
import { FakeJudge } from '../matcher/fake-judge.js';
import { OpenAIJudge } from '../matcher/openai-judge.js';

export function createProviders(env: NodeJS.ProcessEnv = process.env) {
  if (env.JUDGE !== 'openai')
    return {
      judge: new FakeJudge(),
      embeddings: new FakeEmbeddings(),
      transcriber: new FakeTranscriber(),
    };
  const client = new OpenAIClient(env.OPENAI_API_KEY ?? '');
  return {
    judge: new OpenAIJudge(client, env.OPENAI_JUDGE_MODEL),
    embeddings: new OpenAIEmbeddings(client, env.OPENAI_EMBEDDING_MODEL),
    transcriber: new OpenAITranscriber(client, env.OPENAI_TRANSCRIPTION_MODEL),
  };
}
