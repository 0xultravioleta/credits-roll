# Credits Roll

Credits Roll evaluates a Twitch stream transcript alongside chat, credits viewers whose messages changed the stream, shows an OBS pop-up, and rolls end credits. Credited viewers earn reputation for a Channel Points wheel. It never answers chat.

Built from scratch during the Codex x TwitchCon Hackathon, October 23 to November 2, 2026.

## Development

Use Node.js 22.13 or later within Node 22, and npm 10 or later. SQLite uses `better-sqlite3`; supported platforms normally download a prebuilt native binary during installation. A platform without a matching binary needs its normal Node native build toolchain.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

## Offline demo

After `npm ci`, no credentials, `.env` file, paid service, network requests or real stream are needed:

```sh
npm run demo
```

Open [the rehearsal](http://localhost:3000/overlay/?preview=1), or paste `http://localhost:3000/overlay` into an OBS Browser Source. Set OBS to **1920 × 1080**, 30 FPS. The normal overlay is transparent until a pop-up or end credits appear. The preview includes an original canvas backdrop for rehearsal.

The roughly 48-second synthetic stream produces five moments from four viewers, including two ideas from `mapmaker`. A fifth viewer sends `!optout` and never appears in credits or the wheel. Movie-style credits start automatically after the last pop-up. The server stays running until Ctrl+C; late arrivals receive the credits state. Restart the demo to replay it. The demo uses an in-memory database and ignores all credentials, even if they are set in your shell.

For a fast, finite smoke run:

```sh
npm run demo -- --once
```

See [demo/README.md](demo/README.md) for the fixture timeline. The fake transcriber reads synthetic UTF-8 chunks; it is a test double, not speech recognition.

## Local server and development controls

Copy `.env.example` to `.env`, enable `ENABLE_DEV_ENDPOINTS=true` if you want local controls, then:

```sh
npm run dev
```

For a compiled server, run `npm run build` followed by `npm start`. The backend serves the built overlay; Vite's optional development server can be started with `npm run dev --workspace overlay`. Its SSE proxy targets port 3000.

With development endpoints enabled (the demo enables them automatically), send a test credit:

```sh
curl -X POST http://localhost:3000/dev/moment -H 'Content-Type: application/json' -d '{"viewer":"mapmaker","quote":"Try the northern bridge","kind":"idea"}'
curl -X POST http://localhost:3000/dev/credits -H 'Content-Type: application/json' -d '{}'
```

PowerShell equivalent:

```powershell
Invoke-RestMethod http://localhost:3000/dev/moment -Method Post -ContentType 'application/json' -Body '{"viewer":"mapmaker","quote":"Try the northern bridge","kind":"idea"}'
Invoke-RestMethod http://localhost:3000/dev/credits -Method Post -ContentType 'application/json' -Body '{}'
```

The normal server also exposes `POST /dev/transcript` when development endpoints are enabled. Its body is `{ "id": "window-1", "streamId": "my-stream", "startAt": 0, "endAt": 1000, "text": "..." }`, with **actual Unix milliseconds** in place of the example timestamps. Chat must precede `startAt` by no more than 90 seconds. This route runs the matcher, scoring and overlay pipeline; `/dev/moment` intentionally bypasses judging.

Read-only routes: `/health`, `/api/state`, `/wheel`, and `/events` (SSE). Development writes return 404 unless enabled. The default bind address is `127.0.0.1`; no public ingress or EventSub webhook is needed.

## Optional live Twitch chat

Register a Twitch application and obtain an authorized **user access token** with `user:read:chat`. Configure `TWITCH_CLIENT_ID`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BROADCASTER_ID` and `TWITCH_USER_ID` (the token owner's user ID), then set `CHAT_SOURCE=live`. The server creates a real `channel.chat.message` subscription through Helix when the WebSocket welcome arrives. Missing configuration prevents startup. It never requests chat write scope or sends chat messages.

The client handles keepalive loss, reconnect handover, bounded duplicate delivery tracking, subscription revocation, and resubscription after a lost connection. Relayed messages from another shared-chat channel are excluded. See [Twitch's WebSocket documentation](https://dev.twitch.tv/docs/eventsub/handling-websocket-events) and [chat authorization](https://dev.twitch.tv/docs/chat/authenticating).

For local recordings outside the demo, set `RECORDED_CHAT_PATH` to a JSONL file in the format shown in `demo/chat.jsonl`. `npm start` replays it at normal speed. Without a recording or live mode, the server waits for development controls.

## Optional OpenAI providers

The default is `JUDGE=fake`, even if an API key exists. To use the API, set `JUDGE=openai` and `OPENAI_API_KEY`. Model names can be overridden with the three `OPENAI_*_MODEL` variables in `.env.example`. Test and demo code explicitly selects fakes.

- `Transcriber`: `FakeTranscriber` or `OpenAITranscriber` for in-memory audio chunks.
- `Embeddings`: deterministic hashed vectors or OpenAI embeddings for candidate ranking.
- `Judge`: `FakeJudge` or `OpenAIJudge`, using JSON mode and runtime validation.

API mode sends transcript text and candidate chat text to OpenAI. It omits viewer identities from judge inputs, bounds input sizes, disables completion storage, and uses sanitized errors. OpenAI's own data handling policies apply to API processing. No live API calls are part of verification. The request shapes follow official [JSON mode](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat), [transcription](https://developers.openai.com/api/docs/guides/speech-to-text) and [embedding](https://developers.openai.com/api/reference/resources/embeddings/methods/create) documentation.

## Architecture

- `server/`: Fastify, SQLite, chat sources, judging and reputation.
- `overlay/`: Vite, TypeScript and canvas, served by Fastify for OBS.
- `demo/`: synthetic English fixtures; no real viewer data.

```text
recorded JSONL / EventSub WebSocket → transient chat buffer ─┐
audio chunk → Transcriber → transcript window ─────────────┤
                                                          ↓
                                  embeddings → Judge → canonical source validation
                                                          ↓
                             SQLite transaction: moment + reputation → SSE → canvas
                                                          ↓
                                              end credits + local wheel weights
```

Only preceding chat within 90 seconds is eligible. The matcher requires confidence ≥ 0.75, rejects ambiguous identical suggestions from different viewers, and derives the viewer and quote from the original message. A message can earn at most one credit per stream across overlapping windows. `FakeJudge` requires explicit adoption language plus keyword overlap; it is a conservative development heuristic, not a proof of causation.

Points are `round(base × confidence)`, with bases of 10 for ideas, 8 for assists and 6 for riffs. Wheel weight is `min(20, 1 + floor(sqrt(points)))` for credited viewers. Selection supports injected randomness and optional eligibility filtering for future reward redeemers. Stream credits use that stream's retained moments; reputation is a durable aggregate.

## Privacy

Raw chat stays only in a bounded 90-second memory buffer. Audio and transcripts are never persisted. Moment quotes expire at 72 hours on reads, with secure deletion at startup and a periodic job that reserves one minute of headroom. Expired quotes are removed on the next startup if the process was stopped. The SQLite journal is deleted after each transaction rather than retaining quote pages in a persistent WAL. Database backups are the operator's responsibility; do not retain copies with expired chat.

`!optout` is handled before matching. It deletes the viewer, their quotes and aggregate reputation, removes their queued overlay pop-ups and credits, and blocks future credits, including a judge request already in flight. Only the stable viewer ID and opt-out timestamp remain to honor that choice. Never log live chat, transcripts, OAuth tokens or API keys. The demo prints only synthetic moments. See [AGENTS.md](AGENTS.md) for development rules.

## Current scope

This first build delivers the offline pipeline, real EventSub chat client, optional API adapters, local scoring and the OBS overlay. **Self-serve Twitch OAuth onboarding, token refresh/validation scheduling, real stream audio capture, automatic live stream-end detection, and Channel Points redemption subscriptions are not implemented yet.** A live transcript can be supplied through the local development route or `Pipeline.processAudioWindow`; the latter requires an audio capture integration. The wheel is a local weighted selection primitive and weight API, not a Twitch redemption integration. Live Twitch and OpenAI behavior still need authorized integration testing. The browser tool was unavailable during this build; canvas behavior is covered by state tests and the asset/HTTP checks, with visual OBS verification still needed.

See [SUBMISSION.md](SUBMISSION.md) for submission preparation and honest build provenance.
