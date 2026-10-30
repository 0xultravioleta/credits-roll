# Matcher backtest

Run the deterministic offline sample:

```sh
npm run eval
npm run eval -- --write-results
```

Supply three files in this order to test another synthetic dataset:

```sh
npm run eval -- eval/sample/transcript.jsonl eval/sample/chat.jsonl eval/sample/labels.jsonl
```

Use the relative millisecond formats in `sample/`. Transcript rows contain `id`, `startMs`, `endMs` and `text`. Chat rows contain `atMs`, `id`, `viewer: { id, login }` and `text`. Label rows contain `windowId`, `messageId` and Boolean `changed`. Keep each timeline chronological. Make window IDs unique. Label every pair the matcher can predict; include negative examples. Missing prediction labels and duplicate labels fail the run instead of inflating the metrics.

The harness merges chat and transcript timing, honors privacy commands before judging, uses the production 90-second lookback and attributes a source message at most once. It evaluates detections when made. A later opt-out does not rewrite earlier anonymous aggregate counts. It uses `FakeJudge` and `FakeEmbeddings` regardless of environment credentials. It makes no external requests and writes no input data. Errors omit file contents and identifiers.

The sample contains 41 fictional cases: the original 26 matcher fixtures, three harder English cases, six Spanish/mixed cases, one English-chat/Spanish-adoption case and five review cases. Labels tag six Spanish/mixed adoptions and four additional Spanish controls: a greeting, an answered question, topic overlap and a preplanned action. The original topic-only and refusal cases remain separate negative cases. The sixth adoption paraphrases an audio adjustment. The CLI prints `Spanish adoptions: N of 6; Spanish controls: M of 4`, where a correct control means no credit. The offline fake currently gets four adoptions and three controls right; it cannot translate and misses paraphrases. Transcript rows may include an ISO 639-1 `language` hint. This is a development sanity check using fixtures related to the tests, not a held-out benchmark or evidence of performance on real streams. Inspect the cases and labels locally; do not infer causation from the aggregate score.

An explicitly optional provider comparison is `npm run eval -- --real-judge`.
It requires `OPENAI_API_KEY`, sends only these synthetic inputs to the configured
OpenAI judge/embedding models, and may incur API charges. It never runs in tests
or CI, and cannot be combined with `--write-results`. The default command ignores
provider credentials and stays offline. No real-judge result is claimed here.

2026-10-29 — Real judge: NOT RUN; Spanish adoptions N/6; Spanish controls M/4.

`RESULTS.md` contains one numeric row, with columns in this exact order:

`precision recall F1 true-positives false-positives false-negatives true-negatives`

Precision is TP / (TP + FP). Recall is TP / (TP + FN). F1 is the harmonic mean. A zero denominator gives zero. `--write-results` replaces only the numeric report; it never includes headers, chat, usernames, IDs or paths. Regenerate the sample only with `npx tsx server/src/eval/sample.ts`.

Keep real stream recordings outside this repository. Do not commit viewer data. Any future live evaluation needs the owner's authorization, suitable consent and the same retention/deletion rules as the app.
