# Credits Roll — submission preparation

**Deadline:** November 2, 2026, 14:00 Pacific Time.

**Main Codex session ID:** `01a1760f-9f48-7093-9e77-540f44c5027b`

Both `CODEX_SESSION_ID` and `CODEX_THREAD_ID` expose that value. This same main thread built turns 1 through 9 and the additive self-host update.

**Repository URL:** TODO-owner-repository-url

**YouTube demo URL:** TODO-owner-demo-video-url

No commits have been pushed and no Devpost entry has been submitted. The owner handles publication.

## Submission checklist

Turn 10 starts with an isolated PredictionProvider and deterministic fake.
Official Helix limits were checked: 45-character title, 25-character outcomes,
and a 30–1800-second betting window. The separate app measurement period is
10–60 minutes; the native betting window is 120 seconds. Native updates use
LOCKED, RESOLVED with winning_outcome_id, or CANCELED. Only Twitch distributes
or refunds Channel Points. No real prediction has been created by this thread.

The forecast lifecycle persists its native ID, timing and review state. It locks
betting after 120 seconds, counts retained credits from the selected stream and
measurement interval, proposes a result for a separate 120-second review, and
resolves automatically. Corrections exclude a credit from this forecast only.
Capture interruption requests cancellation without changing credit persistence.
Recovery queries native state; interrupted measurement cancels conservatively,
while expired measurement opens the first saved review window. Uncertain
creation is not replayed and uncertain terminal updates reconcile before retry.

Dashboard controls expose the measurement period, live tally, review evidence,
per-credit exclusions, cancellation and reconnect/eligibility explanations. OBS
shows an aggregate tally and countdown without bettor identities. The offline
demo uses FakePredictionProvider and explicitly advances its synthetic timeline;
it creates no native prediction or points. Browser smoke covers a synthetic
3/3 tally, correction to 2/3 and automatic fake resolution. Public Twitch results
and real refunds must still be observed on the owner's authorized streams.

Recovery checks also cover a forecast started before its first notification
reconnect and an unfinished wheel round from an older app version. The browser
check brings the dashboard tab to the foreground before clicking a correction;
Edge's background-tab scrolling stalled the first attempt. The corrected smoke
exercises a real DOM click rather than bypassing the UI.

Credited wheel entrants now retain their draw eligibility and weight while their
entry settles as CANCELED for a Twitch refund. Uncredited eligible entrants are
FULFILLED; privacy removals are CANCELED and excluded. The original winner and
all settlement targets persist before remote requests. Reconcile retries pending
targets and skips confirmed terminal entries. The closed prize list replaces
free text; older saved prizes migrate to Pick the next challenge. No money,
crypto, gift cards or physical prizes are offered. Real refunds remain unverified.

The self-host container recipe pins Node 22, ffmpeg and streamlink, tests during
the build, excludes private data and runs without root. Local container build,
HTTP, fake OAuth and SIGTERM checks have been completed.

Hosted configuration is opt-in through PUBLIC_BASE_URL. It validates an HTTPS
origin, separate session/overlay secrets and a single allowed streamer, derives
the OAuth callback, and prepares distinct private paths under /data. Local
defaults remain available when that variable is absent.

Hosted access controls protect the dashboard with a signed streamer session
and protect the overlay, its assets and SSE with a separate bearer token.
Foreign streamer grants are rejected before token persistence; bot authorization
requires the streamer session at both entry and callback. Trusted proxy HTTPS,
canonical origins, security headers, disabled hosted dev endpoints and bounded
per-IP rate limits are covered by synthetic tests. No real authorization was
performed. Public hosting is prepared; deployment and public TLS remain
owner-managed and unverified by this thread.

Hosted startup selects the private /data paths and restrictive creation mask,
rejects symlink escapes, and disables the local watchdog worker. SIGTERM aborts
owned capture and Helix work, bounds remote cleanup, flushes the debug log and
closes SQLite before the 24-second hard deadline. Synchronous ledger appends
already fsync before credit succeeds. Fake hanging cleanup tests cover the
deadline; actual container shutdown evidence is recorded below after checks.

The container smoke uses a disposable volume/container with synthetic secrets,
fake OAuth and no real Twitch/OpenAI requests. It checks public health, login
redirects, foreign-account rejection before token writes, hidden overlay data,
read-only/non-root operation and graceful SIGTERM. The installed-browser smoke
also exercises hosted session cookies, tokenized assets/SSE and an actual
synthetic pop-up. These checks do not establish public deployment or live OAuth.

Hosted account help preserves the streamer session while switching Twitch logins
for the bot. Expired sessions show a sign-in action without discarding last-known
setup. The public home page links only to sign-in; it never exposes an OBS token.

Turn 9 adds clip and marker provider boundaries with a deterministic offline fake. Helix documentation was checked directly: title/duration query parameters and a 60-second confirmation window are documented; a title maximum and clip-deletion endpoint are not published there. The app applies a conservative 100-character title policy and the documented 140-character marker limit. No live clip has been created by this thread.

The live post-credit job now creates clips and independent markers without awaiting them in the matcher. It enforces persisted 60-second/20-per-stream limits, 403 session disablement, 404 skipping, bounded confirmation, cancellation and privacy-safe ledger enrichment. Confirmed clip notices share the bot limiter, have a separate ninety-second channel cap and honor quiet mode. Both privacy commands remove local media and keep only an anonymous count for remote manual cleanup. No live API request was made during development.

Confirmed clip events update the pop-up, including a late follow-up without duplicate credit. End credits reserve thumbnail space beside each quote. Dashboard history, copy and CSV include clip links/status and marker IDs/offsets; the go-live panel reports clip and VOD requirements. Privacy removes local links and thumbnails and exposes only an anonymous remote-cleanup count. Real Twitch clips and OBS thumbnail rendering remain unverified live.

Offline demo media now uses only the fake provider, a local SVG and a local landing page labeled “Demo clip - not on Twitch.” It illustrates five clips without Helix, OpenAI or chat calls. Practice does not create media. The browser smoke checks the Clipped announcement, thumbnail resource, export columns and privacy erasure with synthetic local metadata. The video outline now qualifies the proposed universal clip promise and requires owner-recorded real Twitch footage.

Turn 8 implements always-on startup and standby. Streamer OAuth requests the four approved future-feature scopes together. Core-only grants remain valid; capability state reports missing scopes and verified channel eligibility without exposing tokens. A separate streamer EventSub connection handles online/offline events, probes Get Streams at startup/reconnect, deduplicates by stream ID, retries capture six times at twenty-second intervals, and preserves explicit Stop for that stream across restarts. That turn prepared permissions; turn 9 implements clips and markers while predictions and polls remain planned.

The header now distinguishes receiving audio, standby, and blocked/connecting states; receipt ages and `/health` fields are numeric and reset honestly on process startup. The go-live checklist includes roles, channel type, permissions, overlay and capture. The supervisor saves a private restart-limit alert that appears on the next successful dashboard connection and requires acknowledgement. This cannot display fresh server state while the server is down. Ledger and debug retention/erasure are unchanged.

An owner-run `scripts/install-autostart.ps1 -Install / -Uninstall` registers a per-user logon task with a stable private Node 22 executable and the existing bounded supervisor. The installer was not run. Tests parse its syntax and exercise a pure task plan only; actual task creation, logon launch and unattended capture remain owner checks.

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
- [x] Auto-listen from online events and already-live startup/reconnect probes; bound initial HLS retries and preserve explicit Stop.
- [x] Show honest audio/chat ages, channel eligibility, scope reconnect actions and the go-live checklist.
- [x] Persist restart-limit alerts and provide an owner-run per-user logon task with stable Node.
- [x] Create optional live clips and markers after credit, with persisted limits and independent failure handling.
- [x] Show Clipped pop-ups, thumbnail credits, clip/marker CSV fields and privacy cleanup counts.
- [x] Demonstrate fake local clips without Helix and update the bot/clip privacy descriptions.
- [x] Add opt-in single-tenant self-host mode, private overlay access, HTTPS proxy support and /data paths without changing local defaults.
- [x] Build and run a pinned non-root container with a read-only root, fake foreign-account rejection and bounded SIGTERM.
- [ ] Owner: publish and verify the public HTTPS deployment, real OAuth callbacks and hosted stream capture.
- [ ] Owner: verify one real clip, public title/footage, marker, notice and thumbnail on the October 30 stream.
- [ ] Owner: install the logon task and verify real startup, offline return, restart recovery and a long capture.
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

## Turn 8 verification

On October 27, 2026, new disposable clones with `git -c core.autocrlf=true clone` and `git -c core.autocrlf=false clone` ran every check below with Node 22.23.4 and installed Edge. Both installed 250 packages, audited 253 packages and reported zero vulnerabilities. Servers used only 3101/3102 or ephemeral unit-test ports. No production process or private production file was accessed. The installer was not executed, and no scheduled task was created, started or stopped.

Actual selected output from autocrlf true:

```text
FRESH CLONE autocrlf=true PORT=3101
CHECK npm ci
CHECK npm test
 Test Files  40 passed (40)
      Tests  252 passed (252)
CHECK npm run typecheck
CHECK npm run lint
CHECK npm run format:check
All matched files use Prettier code style!
CHECK npm run build
CHECK npm run eval
Precision: 0.857143
Recall: 0.923077
F1: 0.888889
CHECK npm run test:bot-mutation
MUTATION KILLED: bypassing the bot filter fails the service-account fixtures.
CHECK npm run test:fetch-mutation
MUTATION KILLED: unbound native fetch regression fails (1 failed test).
CHECK npm run test:watchdog
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3101
CHECK npm run test:watchdog -- --compiled
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3101
CHECK npm run test:browser
BROWSER SMOKE PASS: Edg/153.0.4234.48 | port 3101 | native fetch + go-live checklist + audio ages + reconnect cache + scope notices + channel eligibility + Stop + practice + ledger CSV + privacy + matching settings + debug download/clear verified
CHECK npm run demo -- --once --port=3101
CREDITS ROLL — 5 moments, 4 credited viewers
Offline smoke run complete.
FRESH CLONE autocrlf=true: all checks exited 0
```

Actual selected output from autocrlf false:

```text
FRESH CLONE autocrlf=false PORT=3102
CHECK npm ci
CHECK npm test
 Test Files  40 passed (40)
      Tests  252 passed (252)
CHECK npm run typecheck
CHECK npm run lint
CHECK npm run format:check
All matched files use Prettier code style!
CHECK npm run build
CHECK npm run eval
Precision: 0.857143
Recall: 0.923077
F1: 0.888889
CHECK npm run test:bot-mutation
MUTATION KILLED: bypassing the bot filter fails the service-account fixtures.
CHECK npm run test:fetch-mutation
MUTATION KILLED: unbound native fetch regression fails (1 failed test).
CHECK npm run test:watchdog
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3102
CHECK npm run test:watchdog -- --compiled
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3102
CHECK npm run test:browser
BROWSER SMOKE PASS: Edg/153.0.4234.48 | port 3102 | native fetch + go-live checklist + audio ages + reconnect cache + scope notices + channel eligibility + Stop + practice + ledger CSV + privacy + matching settings + debug download/clear verified
CHECK npm run demo -- --once --port=3102
CREDITS ROLL — 5 moments, 4 credited viewers
Offline smoke run complete.
FRESH CLONE autocrlf=false: all checks exited 0
```

The 252 tests include 25 new tests for requested permissions without invalidating core grants, channel-type eligibility, online parsing and runtime startup, already-live recovery, stream-ID deduplication, offline local credits, six delayed retries, first-chunk stalls, saved Stop, async source failure, stale probe races, timestamps, reconnect copy, restart-safe settings and durable supervisor alerts. The task test parses the installer without running it and checks a separate pure launch plan. Edge checks actual fetch requests, go-live rows, scope notices, hidden ineligible controls, audio status and cached checklist state during a simulated local outage, alongside prior practice, CSV, privacy and debug checks.

Each clone ran the watchdog smoke against both source and compiled code. Only disposable smoke children were deliberately blocked and terminated; real production deadlines are still 90 seconds. Both bot/fetch mutation scripts restored exact source bytes. The demo still produced five synthetic moments, four credited viewers and the same wheel weights. No real chat, transcript, identity or token was written into this repository.

Plan checks and deliberate refinements: the earlier source had only a session-owned offline subscription and no automatic startup. Standby now owns stream notifications independently; the bot chat connection is active only while capturing. An initial attempt receives six additional retries twenty seconds after failure, retaining the sixty-second no-audio deadline. A one-minute stream probe repairs missed notifications and transient startup checks. Explicit Stop pauses the current stream across restarts so practice remains usable. Future permissions do not invalidate core authorization. Affiliate/Partner gating applies to Channel Points, predictions and polls; recognition, clips and markers are not gated by channel type. Future features are permission notices only in this turn. A saved restart-limit alert can appear only after a server becomes reachable again. No script can listen while this computer is off, asleep or logged out.

Remaining owner checks: actual EventSub online/offline delivery, HLS startup timing, automatic resumption after a real supervisor restart, real scope reconnect, verified account/channel type, Windows task registration/logon, the persistent alert under an actual exhausted restart budget and a long unattended capture. The cause of the earlier 41-minute hang remains unknown. Root dist is rebuilt only after the final verification and commit; the owner updates and starts the live copy himself.

## Turn 9 verification

On October 27, 2026, two new outside-repository clones, using `git -c core.autocrlf=true clone` and `git -c core.autocrlf=false clone`, ran with Node 22.23.4 and installed Edge. Both installed 250 packages, audited 253 and reported zero vulnerabilities. Every command below exited zero; browser/demo/watchdog servers used 3101/3102. Unit tests used disposable local instances. No production process, live copy, environment file, token file, personal ledger or real stream data was accessed. No task was installed or operated.

Actual selected output, autocrlf true:

```text
FRESH CLONE autocrlf=true PORT=3101
CHECK npm ci
CHECK npm test
 Test Files  45 passed (45)
      Tests  282 passed (282)
CHECK npm run typecheck
CHECK npm run lint
CHECK npm run format:check
All matched files use Prettier code style!
CHECK npm run build
CHECK npm run eval
Precision: 0.857143
Recall: 0.923077
F1: 0.888889
CHECK npm run test:bot-mutation
MUTATION KILLED: bypassing the bot filter fails the service-account fixtures.
CHECK npm run test:fetch-mutation
MUTATION KILLED: unbound native fetch regression fails (1 failed test).
CHECK npm run test:watchdog
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3101
CHECK npm run test:watchdog -- --compiled
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3101
CHECK npm run test:browser
BROWSER SMOKE PASS: Edg/153.0.4234.48 | port 3101 | Clipped popup + local credits thumbnail + clip/marker CSV + privacy + native fetch + go-live checklist + reconnect + Stop + practice + matching + debug verified
CHECK npm run demo -- --once --port=3101
CREDITS ROLL — 5 moments, 4 credited viewers
DEMO CLIPS — 5 local illustrations; Demo clip - not on Twitch
Offline smoke run complete.
FRESH CLONE autocrlf=true: all checks exited 0
```

Actual selected output, autocrlf false:

```text
FRESH CLONE autocrlf=false PORT=3102
CHECK npm ci
CHECK npm test
 Test Files  45 passed (45)
      Tests  282 passed (282)
CHECK npm run typecheck
CHECK npm run lint
CHECK npm run format:check
All matched files use Prettier code style!
CHECK npm run build
CHECK npm run eval
Precision: 0.857143
Recall: 0.923077
F1: 0.888889
CHECK npm run test:bot-mutation
MUTATION KILLED: bypassing the bot filter fails the service-account fixtures.
CHECK npm run test:fetch-mutation
MUTATION KILLED: unbound native fetch regression fails (1 failed test).
CHECK npm run test:watchdog
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3102
CHECK npm run test:watchdog -- --compiled
WATCHDOG SMOKE PASS: separate worker terminated an isolated blocked main thread; compressed 1-second test deadline; port 3102
CHECK npm run test:browser
BROWSER SMOKE PASS: Edg/153.0.4234.48 | port 3102 | Clipped popup + local credits thumbnail + clip/marker CSV + privacy + native fetch + go-live checklist + reconnect + Stop + practice + matching + debug verified
CHECK npm run demo -- --once --port=3102
CREDITS ROLL — 5 moments, 4 credited viewers
DEMO CLIPS — 5 local illustrations; Demo clip - not on Twitch
Offline smoke run complete.
FRESH CLONE autocrlf=false: all checks exited 0
```

The 282 tests include 30 new cases covering Helix request/response parsing, accepted clip jobs, confirmation/timeout, 403/404 handling, missing scopes, marker VOD errors, persisted creation/announcement limits, quiet mode, provider hangs, Stop, privacy races and anonymous cleanup counts. Legacy records load without media; appended enrichment and uncertain interrupted requests survive new app instances without duplicate points. Both privacy commands remove all local clip revisions, and copy/CSV read only the remaining authoritative records. Demo/practice tests spy on real provider methods and forbid fetch; neither calls Helix. The fake demo illustrates five clips and markers entirely locally.

Edge exercises the actual Clipped accessibility announcement, local thumbnail resource in end credits, added CSV fields, safe links and privacy erasure, alongside prior dashboard/reconnect/practice/debug checks. A synthetic 1920×1080 credits screenshot was inspected outside the repository. This is browser rendering evidence, not an OBS or real Twitch clip test. Both mutation scripts restored exact bytes; source and compiled watchdog smoke runs terminated only their own deliberately blocked disposable children with compressed timing.

Plan checks and refinements: the official Helix Create Clip reference supports title/duration parameters, a five-to-sixty-second duration and sixty-second confirmation, but does not publish a title maximum. The app cap is 100 Unicode characters, not a claimed Twitch limit. The API reference lists no clip-deletion endpoint; local erasure cannot recall public titles or stream footage. Creator Dashboard → Clips is the manual cleanup path. Create Marker returns an ID and offset, not a VOD URL; the UI reports those fields and never fabricates a link. Marker 404 can also mean offline/invalid channel, so VOD availability is not inferred as certain. An opted-out viewer triggers no new media; generic title construction omits their login, and in-flight requests are canceled where possible. Uncertain named requests are counted conservatively for manual review. Creation limits count attempts so failures/restarts/forgetting cannot bypass them. The video voice line is qualified because rate limits and errors prevent a clip for every credit. A failed clip, marker, thumbnail or announcement never changes the persisted credit or reputation.

Unverified live: an actual Twitch clip and its viewer-named title, requested duration, captured audio/footage timing, thumbnail host, VOD marker, bot link, scope reconnect, remote restrictions and Creator Dashboard cleanup. The owner must check these on the October 30/31 streams. No real clip was created, no footage recorded and no video published by this thread. Ledger/debug privacy behavior and the existing always-on lifecycle remain covered by the full suite. Root dist is rebuilt only after final verification and commit; the owner updates and restarts the live copy.

## Self-host verification

Hosted deployment: a self-host image is implemented and locally verified;
the public deployment is owner-managed and has not been verified by this thread.
No deployment-provider identifiers or infrastructure code were added here.

Fresh Windows clones use Node 22.23.4, with `core.autocrlf=true` on port 3101
and `core.autocrlf=false` on port 3102. Both completed `npm ci`, tests,
typecheck, lint, formatting, build, numeric backtest, bot/fetch mutations,
source/compiled watchdog smoke, installed Edge browser smoke and finite demo.
Real output excerpts from the two checkouts:

```text
FRESH CLONE autocrlf=true PORT=3101
 Test Files  48 passed (48)
      Tests  315 passed (315)
All matched files use Prettier code style!
HOSTED BROWSER PASS: port 3101 | signed session + protected state + copyable private URL + tokenized assets/SSE + real popup
CREDITS ROLL — 5 moments, 4 credited viewers
DEMO CLIPS — 5 local illustrations; Demo clip - not on Twitch
Offline smoke run complete.
FRESH CLONE autocrlf=true: all checks exited 0

FRESH CLONE autocrlf=false PORT=3102
 Test Files  48 passed (48)
      Tests  315 passed (315)
All matched files use Prettier code style!
HOSTED BROWSER PASS: port 3102 | signed session + protected state + copyable private URL + tokenized assets/SSE + real popup
CREDITS ROLL — 5 moments, 4 credited viewers
DEMO CLIPS — 5 local illustrations; Demo clip - not on Twitch
Offline smoke run complete.
FRESH CLONE autocrlf=false: all checks exited 0
```

Docker Desktop 29.7.2 built the Linux image on Windows. The base image digest
is pinned; the running tools report Node 22.23.4, streamlink 8.6.2 and ffmpeg
5.1.9-0+deb12u1. The build's Linux suite reports 313 passed and 2 skipped out
of 315: the two PowerShell-dependent tests are skipped on Linux, while all
315 execute on Windows. The image build and synthetic container check exited 0:

```text
CONTAINER HTTP: /health 200 (private-IP Host, no auth, safe fields)
CONTAINER HTTP: /auth/login 302 -> Twitch (HTTPS callback derived)
CONTAINER HTTP: dashboard 401; foreign Host 403; overlay/data without token 404; overlay with token 200; HSTS verified
CONTAINER RUNTIME: read-only root; USER node (UID 1000); private /data volume
streamlink 8.6.2
ffmpeg version 5.1.9-0+deb12u1 Copyright (c) 2000-2026 the FFmpeg developers
CONTAINER AUTH PASS: foreign streamer 403; token writes 0; bot requires owner session (fake OAuth transport)
CONTAINER SIGTERM: exit 0 in 432 ms (<25000 ms)
CONTAINER SMOKE PASS: no real Twitch/OpenAI calls; only disposable resources used
```

The first HTTP smoke correctly received a Host rejection because Node fetch
silently ignored a supplied Host header. An isolated echo test confirmed that
behavior. The smoke now uses Node's HTTP client to model the reverse-proxy hop;
the production Host guard was not relaxed. The Docker credential helper in this
terminal required a private temporary Docker configuration for anonymous public
image pulls; the owner's Docker configuration was not changed.

Plan clarifications: Debian's measured ffmpeg version replaces the proposed
5.1.x guess. A separate bot is intentionally allowed only within the streamer's
authenticated session, rather than applying the streamer ID allowlist to both
roles. Static overlay assets also require/receive the bearer token, preventing
a broken OBS bundle. The foreign-account 403 uses fake OAuth inside the real
container; no real Twitch authorization or public TLS was claimed. Synthetic
EventSub fixtures moved to demo/fixtures to meet the JSONL build-context rule.

The owner server, environment and token files were not operated. Root dist is
rebuilt only as the final operation after verification and commits. Public DNS,
TLS, persistent-volume behavior during an actual redeploy, real hosted OAuth,
live media capture and real Twitch clip/reward operations remain owner checks.

## What remains unverified live

The agent did not authorize an account, inspect the live server or capture real audio. The owner's report above is the only live result supplied for this record. Real token refresh, reward creation, redemption, fulfillment, cancellation, stream-end behavior and bot announcements remain unverified by this thread. The new history, excerpt migration, reconnect behavior and quote-bearing credits have not been deployed or verified on the live channel. Synthetic tests do not establish recognition quality or HLS timing across streams.

Earlier browser-tool attempts were unavailable. Turn 6 instead uses puppeteer-core with an installed Edge/Chrome executable and an isolated headless profile. Browser interaction assertions do not replace human visual review or OBS rendering checks. No claim of Twitch Developer Agreement compliance, third-party processing approval, channel eligibility or real-stream recognition quality is made.

## Owner's live verification

Follow the five steps in [README.md](README.md). Keep credentials in the ignored environment file and the token file outside the repository. Review Twitch's data policy before external processing. Keep the app on loopback.

1. **Stream one (October 30):** apply the update; install/start one logon task yourself; reconnect the streamer once for future permissions; verify both roles, channel type and the OBS connection. While offline expect Standby; go live without pressing Start and wait for fresh audio/chat ages. Stop must cancel retries and allow practice. Resume manually; verify real audio and a deliberate suggestion followed by spoken adoption; inspect the OBS pop-up and counters; enable and redeem the reward; inspect weights and the winner; confirm settlement in Twitch; end the stream and inspect credits. Check quiet mode.
2. **Stream two:** restart one supervised app while the channel is live; expect automatic resumption unless explicitly paused for that stream. Verify persisted authorization and an actual refresh; test reconnect and duplicate handling; test both privacy commands and one confirmation; verify deletion, absence from credits/wheel and pending refunds; verify disconnect and revocation cleanup. Inspect the browser and OBS views and measure HLS delay.

Record actual outcomes and failures. Review remote rewards manually if authorization is lost before cancellation. Do not label an implemented or fake-tested path as live-verified.

## Video outline

**22–60 seconds:** show a real credited pop-up, its confirmed clip notice in chat, then open that clip on Twitch and show the viewer's name in its title. Record this only on an authorized owner stream after confirming it actually works. Use the qualified voice line: “When clips are enabled, your credited moment can become a Twitch clip with your name on it.” The proposed “Every moment becomes…” line overpromises because of cooldowns, the twenty-clip limit, missing permissions and failures. Label offline footage **Demo clip - not on Twitch** and never use it as proof of a live clip.

**110–125 seconds:** roll end credits with confirmed thumbnails beside the viewer quotes. If live clips have not been verified, label the local demo illustrations and state that limitation.

**85–110 seconds:** show Twitch's real native Prediction card, the matching OBS
forecast tally and the actual viewer-side result, such as “You won N points,”
only after a verified real outcome. Voice: “Twitch pays out real Channel Points.
Credits Roll never creates points; it just tells Twitch what chat did.” Do not
invent N, an amount, a stake or a payout in the app or fake demo. Label offline
forecast footage as a simulation with no Twitch points. Show a credited entrant's
confirmed entry refund and one of the four closed prize choices if verified.

Show the problem, this Codex session and a passing check. Show an authorized Twitch suggestion, spoken response and OBS credit. Show a reward entry and wheel result. Finish on the credits. Label synthetic footage clearly. Keep the edit below three minutes and include only material the owner may use.
