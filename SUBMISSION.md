# Credits Roll — submission preparation

**Deadline:** November 2, 2026, 14:00 Pacific Time.

**Main Codex session ID:** `01a1760f-9f48-7093-9e77-540f44c5027b`

Both `CODEX_SESSION_ID` and `CODEX_THREAD_ID` expose that value. This same main thread built turns 1 through 7.

**Repository URL:** TODO-owner-repository-url

**YouTube demo URL:** TODO-owner-demo-video-url

No commits have been pushed and no Devpost entry has been submitted. The owner handles publication.

## Submission checklist

Turn 8 is in progress. Streamer OAuth requests the four approved future-feature scopes together. Core-only grants remain valid; capability state reports missing scopes and verified channel eligibility without exposing tokens. Clips, markers, predictions and polls are not implemented in this turn.

Use the [official rules](https://twitchcon-codex.devpost.com/rules) and [submission guidance](https://twitchcon-codex.devpost.com/resources).

- [x] Write original project code and visuals during the submission period.
- [x] Build with Codex and record the principal session ID.
- [x] Include all source, synthetic fixtures and setup instructions.
- [x] Implement separate streamer/bot OAuth, refresh and private token storage.
- [x] Implement the dashboard, live transcription and EventSub sources.
- [x] Explain the product on the dashboard with a story, setup checklist and separate account roles.
- [x] Provide a credential-free dashboard trial with real matched moments, overlay events, credits and a practice wheel.
- [x] Implement the OBS overlay, end credits and reputation-weighted reward wheel.
- [x] Show retained viewer history, adopting transcript excerpts, scoring rules and an editable prize.
- [x] Preserve account/checklist state during reconnects and include chat quotes in end credits.
- [x] Fix native browser fetch invocation and add a receiver-sensitive test, mutation proof and installed-browser smoke script.
- [x] Save all credited moments in a private local JSONL ledger, import retained SQLite moments idempotently, erase on privacy requests and expose local filters/CSV.
- [x] Explain active listening, provide Stop, surface inline action errors and release ended inputs.
- [x] Expose a local-only credit persistence boundary.
- [x] Filter known service accounts and connected roles before matching, with editable extra logins and a mutation proof.
- [x] Add local temporary diagnostics with 24-hour deletion, a 20 MB cap, download/clear, and privacy erasure.
- [x] Expose trial confidence, lookback and duplicate settings with explicit ordering and an opt-in weak tail.
- [x] Bound capture/provider waits and provide a separate-thread health watchdog and bounded PowerShell restart loop.
- [x] Record the owner's report of one successful live Spanish-audio/chat recognition, without retaining real chat or identities.
- [x] Implement redemption settlement and limited, rate-controlled bot notices.
- [x] Implement both privacy commands, retention and disconnect/revocation cleanup.
- [x] Ship the offline backtest and its numeric-only synthetic report.
- [x] Verify automated tests, typecheck, lint, build and normal-speed offline playback.
- [x] Verify fresh Windows checkouts with `core.autocrlf=true` and `core.autocrlf=false`.
- [x] Prepare English feature and build descriptions.
- [ ] Owner: confirm eligibility and team representation if applicable.
- [x] Owner reported a registered application and connected streamer/bot accounts through the successful live run.
- [ ] Owner: review application scopes and confirm both accounts in the updated dashboard.
- [ ] Owner: confirm live-data processing permissions and keep the working OpenAI key private.
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

Turn 3 reproduced and fixed the CRLF-sensitive report comparison in fresh Windows clones. Turn 4 added the dashboard story, setup checklist, account-specific disconnects, isolated simulation buttons, overlay preview and transient Activity view. This same main thread wrote those changes. The simulation uses the real pipeline, fake providers and a separate in-memory store. Its controls never invoke Twitch actions.

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

After automatic playback, use the dashboard's **Try it without being live** panel. Open **Preview**, choose **Simulate a viewer message**, then **Simulate the streamer speaking**. Expect one practice moment for @mapmaker, one credited viewer, reputation 10 and wheel weight 4. Try the panel's **Roll credits** and **Spin the wheel** buttons. These actions use synthetic inputs and no Twitch accounts or API key. If port 3000 is occupied, use `npm run demo -- --port=3101` and follow the printed dashboard URL.

## What was verified

The owner reported one successful live stream recognition after turn 4: Spanish stream audio and a viewer's chat message produced a credited moment. No real username, chat quote, audio or transcript from that stream is included here. This report establishes one successful recognition, not a complete live reward or privacy verification.

Verification used Windows and Node 22.23.4. All test identities, messages and tokens are synthetic.

| Area             | Evidence                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated suite  | Turn 5: 163 tests in 25 files. Step 0 reverified 164 tests in 26 files in fresh clones with both autocrlf settings. Current ledger verification is recorded below.              |
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

Fresh-clone verification for turn 4 used `git -c core.autocrlf=true clone` and `git -c core.autocrlf=false clone` into separate temporary directories outside the repository. Each clone ran `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build`. Each ran the normal-speed demo through end credits and a finite `--once` replay. A pre-existing local app occupied port 3000, so verification selected an isolated port with `--port=0`; it did not stop the owner's app. All 98 tracked files in turn 3 used LF; `.gitattributes` continues to enforce LF in both checkout modes. The turn 4 suite contains 144 tests in 20 files.

New tests cover missing-tool explanations, checklist readiness, same-account warnings, per-role disconnects, the full practice pipeline and overlay model, counters, credits, wheel weights, credential-free operation, CSRF rejection, live/replay exclusion, repeated simulations, actual SSE connections and Activity expiry/privacy cleanup. Read [README.md](README.md) for current setup, processing permissions and limits.

## Turn 5 fresh-clone evidence

This same thread added retained SQLite credited-viewer history, saved points and adoption excerpts, a scoring-driven reward explanation and prize editor, reconnect state preservation, and quoted end credits. Store migration preserves existing moments and leaves old excerpts empty rather than inventing evidence. All new fixtures are synthetic, including the Spanish excerpt fixture.

Verification used fresh clones outside the repository with `core.autocrlf=true` and `core.autocrlf=false`. Each ran installation, 163 tests in 25 files, typecheck, lint, Prettier, both builds, and the credential-free demo. Verification used ports 3101 and 3102 (unit HTTP tests request ephemeral ports). No check contacted port 3000. Normal-speed replay and HTTP checks verified history, evidence, quote-bearing credits and prize saving in the isolated checkouts.

The live server was left running. No process was stopped, killed or restarted; no environment file, token file or production database was opened or changed. Repository `dist` was rebuilt only as the final step, after fresh-clone verification and the final commit. The owner decides when to restart. Newly added tests cover migration, points, Unicode excerpt limits, grouping/ordering, 90-second Activity expiry, forgetme, retention, fake-fetch reconnect failures, cached text expiry and the complete credit roll layout.

## Turn 6 verification

The owner identified a native-fetch receiver bug that fake fetches missed. Step 0 fixed the source, added a receiver-sensitive double and proved that restoring the original assignment fails that test. Before continuing, fresh clones with both autocrlf settings ran 164 tests, static checks, the mutation proof and real Edge smoke checks on ports 3101/3102. Edge 153.0.4234.48 issued the state request and loaded all checklist statuses.

This same thread then implemented the outside-repository JSONL ledger, atomic append replacement, bounded canonical evidence, idempotent legacy import, restart reads, filtered totals and exports, privacy deletion, disk-failure recovery and the local CreditSink interface. Practice and demo remain in memory and cannot pollute the personal ledger. Both privacy commands erase saved records and block new credits; failed file deletion retains a SQLite opt-out barrier, hides the viewer from the API and retries on startup before import. No record already purged by an older version can be recovered.

The full implementation was verified in fresh Windows clones with `core.autocrlf=true` (port 3101) and `core.autocrlf=false` (port 3102), using Node 22.23.4. Both installed 250 packages with zero reported vulnerabilities. Both ran `npm test`, typecheck, lint, Prettier, overlay/server builds, the fetch mutation proof, real Edge smoke and `npm run demo -- --once --port=3101` (3102 in the second clone). Every command exited 0. Mutation testing restored the exact original source bytes; `git diff --exit-code` stayed clean.

Selected actual output, autocrlf true:

```text
 Test Files  29 passed (29)
      Tests  180 passed (180)
All matched files use Prettier code style!
MUTATION KILLED: unbound native fetch regression fails (1 failed test).
BROWSER SMOKE PASS: Edg/153.0.4234.48 | port 3101 | state requested | checklist loaded | Stop + inline 409 + practice + ledger filters + CSV + privacy verified
CREDITS ROLL — 5 moments, 4 credited viewers
Offline smoke run complete.
FRESH CLONE autocrlf=true: all checks exited 0
```

Selected actual output, autocrlf false:

```text
 Test Files  29 passed (29)
      Tests  180 passed (180)
All matched files use Prettier code style!
MUTATION KILLED: unbound native fetch regression fails (1 failed test).
BROWSER SMOKE PASS: Edg/153.0.4234.48 | port 3102 | state requested | checklist loaded | Stop + inline 409 + practice + ledger filters + CSV + privacy verified
CREDITS ROLL — 5 moments, 4 credited viewers
Offline smoke run complete.
FRESH CLONE autocrlf=false: all checks exited 0
```

The 180 tests cover receiver-sensitive fetch, atomic JSONL persistence, Unicode evidence limits, corruption rejection, the 50 MB warning, SQLite import without duplicates, restart recovery beyond 72 hours, privacy erasure and failed-rewrite recovery, blocked future credits, ledger-based replay deduplication, filters, CSV escaping, sink failure rollback, actionable Start errors and session release after skipped audio. Edge exercises actual network requests, checklist loading, Stop, inline 409 messages, practice counters, saved rows, viewer filtering and CSV exports before and after privacy deletion. No screenshots or real chat are retained.

No production server, environment file, token file, production database or personal ledger was accessed or modified. Every owned test server uses 3101/3102 or an ephemeral unit-test port. The owner chooses when to stop and restart production. Repository dist is reserved for the final operation after verification and the final commit.

## Turn 7 verification

This same thread added bot filtering before matching; the default nine service names, configured names, connected streamer/bot logins and known IDs, and bot badges are excluded. Ordinary moderator/subscriber badges are not treated as bots. It added the outside-repository debug log with bounded chat/transcript snippets, intake and judge decisions, exact thresholds/order, hourly expiry, capacity loss counts, asynchronous writes and privacy deletion. It added matching controls and a plain-language explanation driven by implementation constants. The earliest-copy rule applies to repeated text over 12 characters; unique short suggestions remain eligible, while short reactions such as lol, +1 and f never count.

The new trial threshold is 0.70, adjustable from 0.60 to 0.90. The lookback defaults to 90 seconds, adjustable from 30 to 180. Existing valid saved thresholds are preserved. The 10-second after-reply tail defaults off. Earlier versions supported viewer-first evidence and uncertain ordering inside live chunks; this version can also send explicitly labeled streamer-first weak candidates to the judge. They cannot cause an earlier action, must be riffs and are capped at 0.65 confidence. No automatic tuning was added.

Capture has independent 60-second guards for streamlink and ffmpeg, aborts owned children on Stop, and keeps at most three queued chunks. Provider requests and response-body reads have 30-second aborting limits. A separate worker probes loopback health and forces a non-zero exit after 90 seconds without a valid answer, including when the main thread is blocked. Numeric event-loop lag is reported once per minute above 500 ms. The PowerShell supervisor permits five restarts in a sliding ten-minute window, respects operator stops and does not resume listening automatically. Startup repairs recent ledger-only credits after interrupted commits without duplicate reputation or pop-ups.

Fresh Windows clones with `core.autocrlf=true` (3101) and `core.autocrlf=false` (3102) installed the locked workspaces with Node 22.23.4, then ran tests, typecheck, lint, Prettier, both builds, evaluation, both mutation proofs, source and compiled watchdog smoke checks, real Edge and the credential-free finite demo. All commands exited 0. Both clones ended with `git diff --exit-code` clean. No port-3000 server was used.

Selected actual output, autocrlf true:

```text
 Test Files  35 passed (35)
      Tests  227 passed (227)
All matched files use Prettier code style!
Precision: 0.857143
Recall: 0.923077
F1: 0.888889
MUTATION KILLED: unbound native fetch regression fails (1 failed test).
MUTATION KILLED: bypassing the bot filter fails the service-account fixtures.
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3101
BROWSER SMOKE PASS: Edg/153.0.4234.48 | port 3101 | state + checklist + Stop + inline errors + practice + ledger CSV + privacy + matching settings + debug download/clear verified
CREDITS ROLL — 5 moments, 4 credited viewers
Offline smoke run complete.
FRESH CLONE autocrlf=true: all checks exited 0
```

Selected actual output, autocrlf false:

```text
 Test Files  35 passed (35)
      Tests  227 passed (227)
All matched files use Prettier code style!
Precision: 0.857143
Recall: 0.923077
F1: 0.888889
MUTATION KILLED: unbound native fetch regression fails (1 failed test).
MUTATION KILLED: bypassing the bot filter fails the service-account fixtures.
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3102
BROWSER SMOKE PASS: Edg/153.0.4234.48 | port 3102 | state + checklist + Stop + inline errors + practice + ledger CSV + privacy + matching settings + debug download/clear verified
CREDITS ROLL — 5 moments, 4 credited viewers
Offline smoke run complete.
FRESH CLONE autocrlf=false: all checks exited 0
```

Each watchdog smoke was run twice, first against the source worker and then with `--compiled`. It deliberately blocked only its disposable child; the separate worker wrote WATCHDOG and forced its non-zero exit before the fallback timeout. Fake-clock tests verify the real 90-second health boundary, 30-second provider deadline, both 60-second capture-pipe boundaries, immediate cancellation, capture retries, the 500-ms lag threshold and a broken log sink. A PowerShell function test verifies the sliding restart budget and interrupt handling. This does not establish recovery from every operating-system or native-addon failure.

Browser interaction checks verify a real state request, checklist readiness, Stop, inline errors, practice counters, stored-credit CSV/privacy, the confidence slider, lookback and ignored-login saving, bot counts and debug download/clear. Unit tests cover each default bot, connected identities, renamed IDs, ordinary moderators, opted-out bots after restart, expiry/capacity, redaction, async privacy deletion, duplicate policies, short reactions versus unique short suggestions, explicit prompt ordering, tail bounds/cap/cancellation, settings migration and ledger-only crash recovery. Synthetic evaluation still yields 12 TP, 2 FP, 1 FN and 14 TN; it is not a live-quality claim.

Only synthetic fixtures and disposable local test processes were used. The owner reported the port-3000 server already stopped; this thread did not start or operate it. Environment files, token files and production data were left alone. The root dist build is reserved for the final operation after verification and commit. The 41-minute capture hang is owner-reported and remains undiagnosed. No long live soak, real audio/provider outage, real token refresh or live reward settlement has been verified in this turn.

## What remains unverified live

The agent did not authorize an account, inspect the live server or capture real audio. The owner's report above is the only live result supplied for this record. Real token refresh, reward creation, redemption, fulfillment, cancellation, stream-end behavior and bot announcements remain unverified by this thread. The new history, excerpt migration, reconnect behavior and quote-bearing credits have not been deployed or verified on the live channel. Synthetic tests do not establish recognition quality or HLS timing across streams.

Earlier browser-tool attempts were unavailable. Turn 6 instead uses puppeteer-core with an installed Edge/Chrome executable and an isolated headless profile. Browser interaction assertions do not replace human visual review or OBS rendering checks. No claim of Twitch Developer Agreement compliance, third-party processing approval, channel eligibility or real-stream recognition quality is made.

## Owner's live verification

Follow the five steps in [README.md](README.md). Keep credentials in the ignored environment file and the token file outside the repository. Review Twitch's data policy before external processing. Keep the app on loopback.

1. **Stream one:** authorize the streamer and separate bot; start listening; verify real audio and a deliberate suggestion followed by spoken adoption; inspect the OBS pop-up and counters; enable and redeem the reward; inspect weights and the winner; confirm settlement in Twitch; end the stream and inspect credits. Check quiet mode.
2. **Stream two:** restart the app; verify persisted authorization and an actual refresh; test reconnect and duplicate handling; test both privacy commands and one confirmation; verify deletion, absence from credits/wheel and pending refunds; verify disconnect and revocation cleanup. Inspect the browser and OBS views and measure HLS delay.

Record actual outcomes and failures. Review remote rewards manually if authorization is lost before cancellation. Do not label an implemented or fake-tested path as live-verified.

## Video outline

Show the problem, this Codex session and a passing check. Show an authorized Twitch suggestion, spoken response and OBS credit. Show a reward entry and wheel result. Finish on the credits. Label synthetic footage clearly. Keep the edit below three minutes and include only material the owner may use.
