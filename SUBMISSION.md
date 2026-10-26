# Credits Roll — submission preparation

**Codex x TwitchCon Hackathon deadline:** November 2, 2026, 14:00 Pacific Time.

**Main Codex session ID:** `01a1760f-9f48-7093-9e77-540f44c5027b`

The build environment exposes this same value as both `CODEX_SESSION_ID` and `CODEX_THREAD_ID`. This is the main thread that wrote the repository.

**Repository URL:** TODO-owner-repository-url

**YouTube demo URL:** TODO-owner-demo-video-url

This file prepares the submission; no entry has been submitted and no commits have been pushed.

## Submission checklist

Based on the [official rules](https://twitchcon-codex.devpost.com/rules) and [submission guidance](https://twitchcon-codex.devpost.com/resources), checked October 25, 2026:

- [x] Create original project work during the October 23–November 2 submission period.
- [x] Build with OpenAI Codex; record the principal build session ID above.
- [x] Implement a Twitch connection: EventSub chat client and an OBS Browser Source overlay.
- [x] Include source, original visual code, synthetic data and reproducible setup instructions.
- [x] Prepare an English feature description and explanation of Codex use below.
- [x] Verify credential-free installation, automated tests and a runnable offline demonstration.
- [ ] Owner: confirm individual/team eligibility and any team representative requirements.
- [ ] Owner: publish the repository URL; if private, grant the reviewer access specified in the rules.
- [ ] Owner: verify the actual Twitch/OBS integration and ensure advertised behavior matches the build.
- [ ] Owner: record a video under three minutes showing Twitch functionality and Codex development.
- [ ] Owner: upload the video to YouTube with judge-visible access and supply its URL.
- [ ] Owner: check permissions for any third-party footage, branding, music or other material used.
- [ ] Owner: keep the project available to judges without a fee through the judging period ending November 15.
- [ ] Owner: complete the Devpost fields and submit before the deadline; a saved draft is insufficient.

## Project description draft

Credits Roll gives a stream's supporting cast their due. It compares preceding viewer messages with the streamer's transcript, recognizes a concrete idea, assist or riff that the streamer adopted, and shows `@viewer moved the stream: <quote>` in an OBS overlay. At the end of the rehearsal, a movie-style roll names the credited viewers. Moments earn reputation, which produces capped weights for a local wheel. The system evaluates and credits; it never answers or sends Twitch chat messages. Viewers can send `!optout` to remove their credits and prevent future recognition. The included offline demo uses entirely fictional English chat and transcripts. A real EventSub client and optional OpenAI transcription, embeddings and JSON judging adapters are implemented behind interfaces. Self-serve OAuth onboarding, live audio capture, automatic stream-end detection and Channel Points redemption wiring remain future work for this v0.

## How we built it

This main Codex thread wrote the code, tests, synthetic fixtures, canvas visuals and documentation in this repository, starting from an empty working tree during the hackathon. The owner supplied the product direction and stack. Codex implemented and committed the eight requested stages, checked official API documentation, ran the tests and demo, and verified installation and playback in a clean local clone. Claude Code was only a planning/review assistant outside the repository; it did not write repository files. All project-specific code and visual assets were newly written for this build. Standard npm dependencies provide the framework and tooling.

## Reproduction for judges

Use Node.js 22.13 or later within Node 22 and npm 10 or later:

```sh
npm ci
npm test
npm run demo
```

Open `http://localhost:3000/overlay/?preview=1`. In OBS, add `http://localhost:3000/overlay` as a 1920 × 1080 Browser Source. The rehearsal lasts roughly 48 seconds; five moments and four viewers are expected, followed by end credits. The process stays running until Ctrl+C. No credentials or external requests are used by the demo, including when API credentials exist in the shell environment. The finite alternative is `npm run demo -- --once`.

Expected reputation and wheel weights:

| Viewer        | Moments | Reputation | Weight |
| ------------- | ------: | ---------: | -----: |
| `mapmaker`    |       2 |         20 |      5 |
| `mixcraft`    |       1 |          8 |      3 |
| `switchwitch` |       1 |          8 |      3 |
| `punpilot`    |       1 |          6 |      3 |

The fictional viewer `quietartist` opts out before the relevant response and must be absent from all four outputs: stored moments, reputation, credits and wheel entries.

## Verification and remaining release work

Verified on Windows with Node 22.23.4: `npm ci`, `npm test` (77 passing tests), `npm run typecheck`, `npm run lint`, `npm run build`, normal-speed `npm run demo`, and clean-clone `npm run demo -- --once`. Actual HTTP checks confirmed the overlay returns 200 and the final state contains four credits with no opted-out viewer. The API adapter tests use mocked responses; the full replay test forbids external fetch calls.

The browser tool was unavailable, so this thread could not visually verify rendering in an actual browser or OBS. Live Twitch authorization, real audio transcription and external API integration were not exercised. Complete those authorized integration checks, visual OBS verification and the remaining product work listed in [README.md](README.md) before presenting the build as a self-serve live product.

## Suggested video outline

1. Explain the problem: chat shapes the stream but its contributions disappear.
2. Show this Codex build thread and its tests briefly.
3. Show an authorized Twitch stream and an actual viewer suggestion followed by a spoken adoption and pop-up. Label any synthetic rehearsal footage clearly.
4. Demonstrate opt-out behavior and explain the local wheel weights accurately.
5. Finish on the end credits, with the credited viewers as the supporting cast.

Keep the final edit below three minutes and use only footage and audio the owner is authorized to include.
