# Devpost submission copy

Paste each field below into Devpost. Replace both URL placeholders before submitting.

## Project name

Credits Roll

## Tagline

Give Twitch viewers credit when their chat changes the stream.

## Inspiration

A viewer suggests a route, fixes an audio problem or starts a running joke. The streamer adopts it, but that contribution can disappear in the chat scroll. We wanted those moments to have an on-screen credit and a place in the stream's closing credits.

The key question is not whether a message is popular or on topic. It is whether the streamer actually used it.

## What it does

Credits Roll listens to a Twitch broadcast and reads its chat together. It looks for explicit spoken adoption of a viewer's message, then shows an OBS pop-up such as “@mapmaker moved the stream: Try the northern bridge.” It classifies the contribution as an idea, assist or riff, gives it reputation points and saves a short quote with the streamer's adopting words.

The dashboard explains each credit and keeps a searchable history across restarts. End credits list credited viewers with their quotes. Optional live clips and VOD markers help preserve a moment; clip failures never block a credit. The separate bot account can announce a confirmed clip, end credits or a wheel winner. It never answers chat questions.

On eligible Affiliate or Partner channels, viewers can enter a reputation-weighted Channel Points wheel for one of four creative prizes. Credited viewers' entries can be refunded without removing them from the draw. A native Twitch Prediction lets chat forecast whether it will move the stream at least three times during a measurement period. The app proposes the result automatically and gives the streamer 120 seconds to correct it. Twitch alone distributes Prediction points and refunds canceled entries. Credits Roll never creates Channel Points or pays money.

Auto language follows the stream's language, including Spanish, while saved explicit language choices remain available. Auto-listen can wait for a channel to go live and recover after a restart. Matching remains an estimate of influence, not proof of causation.

## How we built it

Most of the project was built over 13 turns in **one main Codex thread**, session **01a1760f-9f48-7093-9e77-540f44c5027b**. The owner supplied the product idea, stack, priorities and feedback from streaming. Codex wrote the TypeScript backend, SQLite store, private JSONL ledger, Twitch integrations, audio/transcription pipeline, matcher, scoring, OBS overlay, dashboard, offline providers, synthetic fixtures, tests and documentation. This submission pack is Turn 14 of that same thread.

Planning and independent reviews happened outside Codex, including Claude Code as a planning/review assistant outside the repository. Deployment and infrastructure were handled separately outside Codex. They are not claimed as Codex's work. Project code and fixtures were newly written during the hackathon; standard libraries provide the framework and tooling.

The backend uses Fastify and SQLite. The overlay uses Vite, TypeScript and canvas, with server-sent events for updates. Twitch EventSub uses an outbound WebSocket. Optional live audio goes through streamlink and ffmpeg into OpenAI transcription; embeddings and a JSON judge evaluate candidate messages. Every provider has an offline boundary, so judges can run the synthetic rehearsal without Twitch credentials or an API key.

## Challenges we ran into

- Separating an adopted contribution from a greeting, answered question or merely related topic. We require spoken adoption, label timing explicitly and keep negative controls in the synthetic evaluation.
- Making Spanish streams work on a fresh installation. Auto now resolves and refreshes the stream language, and the judge considers Spanish and mixed-language meaning.
- Keeping live capture honest during provider failures and cached Twitch responses. Transient chunk failures preserve chat; empty stream probes cannot end healthy capture just because Twitch briefly returns no row.
- Testing beyond an existing working tree. Fresh Windows clones exposed line-ending assumptions, and an installed-browser check caught a native fetch invocation regression.
- Keeping recognition durable without making data permanent by accident. The private ledger has bounded evidence, and privacy commands erase local viewer records. Twitch-hosted clips still require separate deletion by the streamer.

## Accomplishments that we're proud of

On **November 1, 2026, at approximately 15:50 UTC**, the owner confirmed that the separate bot account exists and works, and that Credits Roll ran on a real Twitch stream and worked very well. This is an owner report, not an independent verification of every feature.

For this submission pack, a fresh Windows clone with `core.autocrlf=true` reported **403 passing tests in 58 test files**, with external network requests blocked. The exact quick-start commands below also ran using a populated offline npm cache. The rehearsal produced **five moments from four fictional viewers**, followed by end credits. Its dashboard and overlay preview returned HTTP 200. These are deterministic software checks, not a live recognition accuracy measurement.

The remaining submission work is recording the screen demo and submitting on Devpost. Individual real clips, markers, Prediction outcomes, payouts and wheel refunds still need feature-specific evidence; general live success does not certify them.

## What we learned

A useful credit needs an explanation: both what the viewer wrote and what the streamer said when adopting it. Counters alone did not explain the product to the owner, so the dashboard gained a story, guided setup, practice buttons and a persistent credit list.

Live reliability also needs visible state. “Listening,” “Standby,” a provider rejection and a reconnecting dashboard mean different things. Language fallback warnings, audio/chat ages and counter-only minute logs make those differences inspectable without printing live chat or transcripts.

Offline fakes make development repeatable. They do not verify Twitch permissions, actual payouts, real clip timing or model accuracy on a live channel. Those claims need separate evidence.

## What's next

Record authorized live footage and the Codex development segment, replace the submission links and submit before the deadline. Verify individual clip, marker, Prediction and refund behavior on real streams. Expand the multilingual evaluation and review false credits and missed adoptions before changing matching thresholds. Keep the project available for judging.

## Built with

Codex, Node.js 22, TypeScript, Fastify, SQLite, better-sqlite3, Vite, HTML, CSS, canvas, server-sent events, Vitest, ESLint, Prettier, puppeteer-core, Twitch OAuth, Twitch EventSub WebSocket, Twitch Helix, OBS Studio, OpenAI API, streamlink, ffmpeg, Docker.

OpenAI, Twitch credentials and live capture tools are optional for the offline demo. Docker is optional for running the project.

## Try it — judges

Use Node.js 22.13 or later within Node 22, and npm 10 or later. In a checkout of this repository, run the same commands as the [README quick start](README.md#try-it-in-60-seconds):

```sh
npm ci
npm run demo -- --port=3101
```

Open <http://localhost:3101/dashboard> and <http://localhost:3101/overlay/?preview=1>. Wait about 48 seconds for five synthetic moments, four credited viewers and the end credits. Leave the terminal open; Ctrl+C stops it. Restart the demo to replay.

After the automatic rehearsal ends, use **Try it without being live** on the dashboard: click **Simulate a viewer message**, then **Simulate the streamer speaking** within 90 seconds. Watch the pop-up, then use that panel's **Roll credits** and **Spin the wheel** buttons. These are simulations through the real pipeline, not Twitch redemptions or payouts.

No Twitch account, live stream or OpenAI key is required. Installation needs registry access or a populated offline npm cache; the demo itself makes no external requests. It uses synthetic text, an in-memory database and deterministic fakes. Fake media says **Demo clip - not on Twitch**. The fake forecast advances time and distributes no Twitch points. If 3101 is busy, leave that process alone and use `npm run demo -- --port=3102` with the printed URLs.

## Repository URL

**PLACEHOLDER — replace with the repository URL and grant judges access before submission.**

## Video URL

**PLACEHOLDER — replace with the uploaded, judge-accessible video URL (under three minutes).**
