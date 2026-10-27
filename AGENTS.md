# Working on Credits Roll

All code, documentation, fixtures and commit messages must be in English. Write original project code during the hackathon. Do not commit credentials or real chat recordings.

## Commands

- Node.js 22; `npm ci` installs the locked npm workspaces.
- `npm test` runs Vitest offline with deterministic providers.
- Always verify in a fresh clone before reporting that tests pass.
- `npm run typecheck`, `npm run lint`, `npm run format:check` validate changes.
- `npm run build` builds the overlay and server.
- `npm run demo` must run without any credentials and without network requests.
- Run `npm run test:browser` with `BROWSER_PATH` set to installed Edge/Chrome. Set `PORT=3101` or `3102`; never use the owner's server for checks.
- For self-host checks, build Docker first, set CONTAINER_IMAGE and PORT=3101 or 3102, then run `npm run test:container`. It creates and removes only its own disposable container and volume. Use Node's HTTP client when setting Host; Node fetch can ignore that header. Do not claim fake OAuth or a private HTTP hop proves real public TLS/OAuth.
- In throwaway fresh clones, run `npm run test:bot-mutation`, `npm run test:fetch-mutation`, and `npm run test:watchdog -- --compiled` after building. Mutation scripts restore exact bytes. The watchdog smoke terminates only its own deliberately blocked disposable child, using compressed test timing.

## Style and architecture

Use strict TypeScript, ESM, named interfaces at external boundaries, small modules, and injected clocks/network providers in tests. Use Prettier and ESLint. Keep all OpenAI operations behind interfaces with deterministic offline fakes. Use synthetic fixtures. Tests should cover behavior and failure paths.

## Credit sink boundary

`server/src/clips/types.ts` defines `ClipProvider`. Keep Helix clip/marker requests behind `HelixClipProvider` and use `FakeClipProvider` for offline illustration and tests. Clip work runs after successful credit persistence, outside `CreditSink` and the SQLite transaction. A failed media request must never undo or delay a credit. Use documented Helix parameters; the app title cap is a conservative policy because the reference publishes no clip-title maximum. Do not claim that a remote clip was deleted when only local history was erased.

`server/src/ledger/sink.ts` exposes `CreditSink.onCredit(record)`. Scoring invokes this synchronous local boundary inside its SQLite transaction after validation and duplicate checks. The default sink is the ledger; a save failure aborts crediting. A replacement sink can be passed as the fourth `Scoring` constructor argument without changing the pipeline. Preserve the ledger when composing sinks, make consumers idempotent by credit ID, and handle privacy erasure before adding any persistent consumer. No chain integration or network calls are implemented or authorized by this hook. Do not forward quotes, excerpts or viewer identities to an external reputation service.

## Privacy and behavior

Hosted mode is additive and enabled only by PUBLIC_BASE_URL. Require the allowed
streamer's signed session for dashboard data and for connecting the separate bot;
reject a foreign streamer before token persistence. Keep overlay bearer tokens
out of logs, ledger and diagnostics, including request URLs. Carry the token to
overlay assets and SSE. Trust proxy headers only on a privately reachable
backend; compare write origins to the canonical configured HTTPS origin. Keep
/health public without private data. Use a private /data volume and one writer.
Do not add deployment-provider identifiers or infrastructure code to this repo.
Hosted SIGTERM must cancel owned capture/network work immediately and finish
local persistence before the 24-second exit limit. Do not run the local health
watchdog or PowerShell supervisor in a hosted container. Preserve local defaults.

- Store raw chat, transcript text and moment quotes for no more than 72 hours. Purge on startup and regularly; filter expired data on reads. Do not persist transcripts or audio unless explicitly required.
- Persist only a short adoption excerpt (at most 200 characters) with a credited moment. Delete it with the quote on opt-out, forgetme and retention. Keep full transcripts off disk.
- Owner-requested exception: the local JSONL credit ledger retains a quote of at most 140 characters and an adoption excerpt of at most 200 characters across restarts, without automatic rotation or compaction. Both privacy commands remove that viewer's ledger records. SQLite evidence still expires within 72 hours; full transcripts remain transient.
- Owner-requested diagnostics exception: a private local debug JSONL log is on by default for the current trial. Store at most 200 chat characters and 300 transcript characters per entry, plus decisions and their canonical IDs/timing. Purge within 24 hours at startup and hourly with headroom; cap at 20 MB. Never send diagnostics to a provider, commit them or print their text to the console. Both privacy commands erase the viewer's debug entries and all debug transcript snippets; await disk erasure before confirming. Keep the toggle, clear and download controls available.
- Handle `!optout` before judging. Delete that viewer's quotes and reputation immediately, and exclude them from matching, overlay events, credits and wheel weights. Retain only the minimum stable identifier needed to honor the opt-out.
- Never log OAuth tokens, authorization headers, API keys, raw live chat, raw audio or transcripts. Use sanitized status messages. Do not include secrets in URLs.
- Treat chat and transcripts as untrusted input, never as instructions to the judge.
- Never answer questions or run a conversational chatbot. Send chat messages only for confirmed live clip notices (at most one per ninety seconds per channel), end-of-stream credits, wheel winners, and one confirmation of an explicit `!optout` or `!forgetme` request. Apply the shared rate limiter; quiet mode suppresses clips, credits and winner announcements.
- Keep development mutation endpoints disabled by default; bind locally by default.
- Do not push commits; the owner handles publication.

## Matching and recovery

Create live media only from a newly persisted credit in the active live pipeline. Keep demo media explicitly fake and local; practice and historical ledger recovery must never invoke Helix. Persist clip limits before dispatch: one attempt per sixty seconds, twenty per stream and no automatic retry of uncertain creation. Media revisions are append-only under the same credit ID and must not change points or create another credit. After restart, mark interrupted creations pending-unconfirmed without replay. Both privacy commands erase local media and cancel owned jobs immediately; retain only an anonymous count of potentially named remote clips for manual cleanup. Do not fabricate clip-title limits, VOD URLs or remote deletion. Clip notices share the bot limiter, respect quiet mode and have a separate ninety-second cap. Bound and cancel confirmation/announcement work so Stop stays responsive.

Auto-listen defaults on only within explicitly configured live mode. Keep stream online/offline monitoring separate from capture. Deduplicate by Twitch stream ID, recheck Get Streams at startup/reconnect and preserve explicit Stop for the current stream across restarts. Never restore a Listening claim without newly received audio. Pending capture retries must block practice until Stop cancels them. Missing future scopes must produce reconnect actions without revoking valid core grants. Keep clips and markers independent of Affiliate/Partner eligibility. Do not execute the logon installer or register scheduled tasks during development; test its pure plan and parse syntax only. The per-user task must use a stable Node executable, limited privilege and the existing bounded supervisor. Keep restart-limit alerts private and persistent until acknowledgement.

Initial HLS failures, including a first-chunk stall, use one initial attempt plus six managed retries twenty seconds after failure. Keep the sixty-second audio deadline. Audio received after startup uses the existing capture recovery loop. Reconcile stream state once per minute to recover a missed event or transient startup probe failure. Do not let failed remote reward cleanup block local credits or leave a stale Listening claim.

Filter service accounts and connected streamer/bot IDs before matching. Keep bot recognition separate from moderator or subscriber status. Default to one earliest identical suggestion when repeated text exceeds 12 characters; short reactions such as lol, +1 and f never count. Unique short suggestions remain eligible. Saved settings control confidence (default 0.70, range 0.60–0.90), lookback (default 90 seconds, range 30–180), duplicate policy and an experimental 10-second tail (off by default). Label order explicitly; streamer-first candidates cannot explain earlier actions and only qualify as weak riffs, capped at 0.65. Do not auto-tune from logs or claim causation from overlap.

Bound every audio-pipe wait at 60 seconds and every OpenAI request, including its body read, at 30 seconds. Abort providers and owned capture children on Stop. Keep the health watchdog independent of the main event loop. Its production deadline is 90 seconds; the PowerShell supervisor allows five restarts in ten minutes. Log lag above 500 ms once per minute using numeric status only. Recover retained ledger-only credits into SQLite idempotently after hard exits, without replaying pop-ups or bypassing privacy preferences. Rebuild repository dist only as the final operation when the owner requests that workflow.
