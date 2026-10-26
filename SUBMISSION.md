# Credits Roll — submission preparation

**Deadline:** November 2, 2026, 14:00 Pacific Time.

**Main Codex session ID:** `01a1760f-9f48-7093-9e77-540f44c5027b`

Both `CODEX_SESSION_ID` and `CODEX_THREAD_ID` expose that value. This same main thread built turns 1 and 2.

**Repository URL:** TODO-owner-repository-url

**YouTube demo URL:** TODO-owner-demo-video-url

No commits have been pushed and no Devpost entry has been submitted. The owner handles publication.

## Submission checklist

Use the [official rules](https://twitchcon-codex.devpost.com/rules) and [submission guidance](https://twitchcon-codex.devpost.com/resources).

- [x] Write original project code and visuals during the submission period.
- [x] Build with Codex and record the principal session ID.
- [x] Include all source, synthetic fixtures and setup instructions.
- [x] Implement separate streamer/bot OAuth, refresh and private token storage.
- [x] Implement the dashboard, live transcription and EventSub sources.
- [x] Implement the OBS overlay, end credits and reputation-weighted reward wheel.
- [x] Implement redemption settlement and limited, rate-controlled bot notices.
- [x] Implement both privacy commands, retention and disconnect/revocation cleanup.
- [x] Ship the offline backtest and its numeric-only synthetic report.
- [x] Verify automated tests, typecheck, lint, build and normal-speed offline playback.
- [x] Prepare English feature and build descriptions.
- [ ] Owner: confirm eligibility and team representation if applicable.
- [ ] Owner: register the Twitch application and create a separate bot account.
- [ ] Owner: supply the OpenAI key and obtain required live-data processing permissions.
- [ ] Owner: complete the two authorized live streams below and visual OBS checks.
- [ ] Owner: publish the repository URL and grant reviewer access if private.
- [ ] Owner: upload a YouTube video under three minutes showing Twitch functionality and Codex development.
- [ ] Owner: check rights to all video footage, music and other material.
- [ ] Owner: keep the project available for judging through November 15.
- [ ] Owner: complete the Devpost fields and submit before the deadline.

Implementation checkmarks describe shipped code, not live integration verification.

## Project description draft

Credits Roll compares Twitch chat with a stream transcript and recognizes a viewer's adopted idea, assist or riff. It shows `@viewer moved the stream: <quote>` on an OBS canvas overlay and rolls the credited names at the end. A local dashboard connects separate streamer and bot accounts, controls the session and displays recent transcript windows. Reputation adds weight to redeemed Channel Points entries. The bot never answers questions; it sends only end credits, wheel winners and one confirmation attempt for an explicit privacy command. The offline rehearsal uses fictional chat and transcripts. Live OAuth, EventSub, streamlink/ffmpeg capture, OpenAI adapters and Helix redemption handling are implemented; real-account behavior still requires the owner-run checks below.

## How we built it

This same main Codex thread wrote the code, tests, fixtures, visuals and documentation from an empty working tree during the hackathon. The owner supplied the idea, stack and ordered build requests. Turn 1 delivered eight commits for the offline pipeline and overlay. Turn 2 added OAuth, the dashboard, live transcription, redemptions, privacy commands and evaluation, then revised the judge documentation and submission record. Codex checked official API documentation and ran the available tests and demo. It also added cleanup for authorization revocation and disconnected sessions. Claude Code was only a planning/review assistant outside the repository; it did not write repository files. No project-specific prior code, real recordings or credentials were imported. Standard npm dependencies supply framework and tooling functions.

## Try the offline build

Use Node 22.13 or later within Node 22 and npm 10 or later:

```sh
npm ci && npm run demo
```

Open `http://localhost:3000/dashboard` and `http://localhost:3000/overlay/?preview=1`. Use `http://localhost:3000/overlay` for a 1920 × 1080 OBS Browser Source. Wait about 48 seconds for five moments and four credited viewers, followed by end credits. Keep the server open until Ctrl+C. Use `npm run demo -- --once` for a finite smoke run. The opted-out fictional viewer must have no moment, reputation, credit or wheel entry. No external requests occur.

| Synthetic viewer | Moments | Reputation | Weight |
| ---------------- | ------: | ---------: | -----: |
| `mapmaker`       |       2 |         20 |      5 |
| `mixcraft`       |       1 |          8 |      3 |
| `switchwitch`    |       1 |          8 |      3 |
| `punpilot`       |       1 |          6 |      3 |

## What was verified

Verification used Windows and Node 22.23.4. All test identities, messages and tokens are synthetic.

| Area             | Evidence                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated suite  | 125 passing tests in 19 files.                                                                                                                                                  |
| Static checks    | Typecheck, lint, formatting and both production builds pass.                                                                                                                    |
| Offline pipeline | Normal-speed demo prints five moments, four credited viewers and the expected wheel weights. Demo and evaluation tests forbid external fetch calls.                             |
| HTTP delivery    | Dashboard HTML, script, stylesheet and overlay return 200. State reports five moments, four credited viewers and the credits phase. Dashboard JavaScript passes a syntax check. |
| OAuth            | Fakes test scopes, browser-bound single-use state, CSRF rejection, account separation, expiry, rotation, refresh scope formats and revoked authorization.                       |
| Token files      | Temporary-file tests verify repository exclusion and persistence. Code requests 0600. POSIX permission assertions run only where supported; Windows ACLs were not verified.     |
| Audio boundary   | Fake-runner tests cover missing-key/tool skips, language and cancellation. Unit tests cover PCM/WAV format and chunk timestamps.                                                |
| EventSub         | Synthetic payloads and fake sockets cover parsing, duplicate deliveries and reconnect handover.                                                                                 |
| Helix and wheel  | Fakes cover rewards, weights, settlement, retry consistency, 401 refresh and 429 backoff. Fake-clock tests cover 20 sends per 30 seconds and one per second per channel.        |
| Privacy          | Tests cover both commands, one confirmation attempt, in-flight judges, history and wheel deletion, retention, old-schema migration, disconnect, revocation and overlay reset.   |
| Backtest         | 29 synthetic cases: precision 0.857143, recall 0.923077, F1 0.888889. This is not a live or held-out benchmark. `eval/RESULTS.md` contains only numbers.                        |

Turn 1 additionally verified installation and finite playback in a fresh local clone. Read [README.md](README.md) for current setup, processing permissions and limits.

## What was not verified

No real Twitch account was authorized here. No real OAuth grant, token refresh, EventSub notification, reward creation, redemption, fulfillment, cancellation, stream-end event or chat post was exercised. No real stream audio was captured and no request reached OpenAI. The streamlink/ffmpeg subprocess path was not run against a live channel; fake-runner tests do not establish media access, timing or platform compatibility.

The browser tool returned no browsers or apps. Visual dashboard, canvas and OBS rendering remain unverified. HTTP delivery and state tests do not replace visual checks. No claim of Twitch Developer Agreement compliance, third-party processing approval, channel eligibility or real-stream recognition quality is made.

## Owner's live verification

Follow the five steps in [README.md](README.md). Keep credentials in the ignored environment file and the token file outside the repository. Review Twitch's data policy before external processing. Keep the app on loopback.

1. **Stream one:** authorize the streamer and separate bot; start listening; verify real audio and a deliberate suggestion followed by spoken adoption; inspect the OBS pop-up and counters; enable and redeem the reward; inspect weights and the winner; confirm settlement in Twitch; end the stream and inspect credits. Check quiet mode.
2. **Stream two:** restart the app; verify persisted authorization and an actual refresh; test reconnect and duplicate handling; test both privacy commands and one confirmation; verify deletion, absence from credits/wheel and pending refunds; verify disconnect and revocation cleanup. Inspect the browser and OBS views and measure HLS delay.

Record actual outcomes and failures. Review remote rewards manually if authorization is lost before cancellation. Do not label an implemented or fake-tested path as live-verified.

## Video outline

Show the problem, this Codex session and a passing check. Show an authorized Twitch suggestion, spoken response and OBS credit. Show a reward entry and wheel result. Finish on the credits. Label synthetic footage clearly. Keep the edit below three minutes and include only material the owner may use.
