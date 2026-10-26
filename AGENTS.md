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
- In throwaway fresh clones, run `npm run test:bot-mutation`, `npm run test:fetch-mutation`, and `npm run test:watchdog -- --compiled` after building. Mutation scripts restore exact bytes. The watchdog smoke terminates only its own deliberately blocked disposable child, using compressed test timing.

## Style and architecture

Use strict TypeScript, ESM, named interfaces at external boundaries, small modules, and injected clocks/network providers in tests. Use Prettier and ESLint. Keep all OpenAI operations behind interfaces with deterministic offline fakes. Use synthetic fixtures. Tests should cover behavior and failure paths.

## Credit sink boundary

`server/src/ledger/sink.ts` exposes `CreditSink.onCredit(record)`. Scoring invokes this synchronous local boundary inside its SQLite transaction after validation and duplicate checks. The default sink is the ledger; a save failure aborts crediting. A replacement sink can be passed as the fourth `Scoring` constructor argument without changing the pipeline. Preserve the ledger when composing sinks, make consumers idempotent by credit ID, and handle privacy erasure before adding any persistent consumer. No chain integration or network calls are implemented or authorized by this hook. Do not forward quotes, excerpts or viewer identities to an external reputation service.

## Privacy and behavior

- Store raw chat, transcript text and moment quotes for no more than 72 hours. Purge on startup and regularly; filter expired data on reads. Do not persist transcripts or audio unless explicitly required.
- Persist only a short adoption excerpt (at most 200 characters) with a credited moment. Delete it with the quote on opt-out, forgetme and retention. Keep full transcripts off disk.
- Owner-requested exception: the local JSONL credit ledger retains a quote of at most 140 characters and an adoption excerpt of at most 200 characters across restarts, without automatic rotation or compaction. Both privacy commands remove that viewer's ledger records. SQLite evidence still expires within 72 hours; full transcripts remain transient.
- Owner-requested diagnostics exception: a private local debug JSONL log is on by default for the current trial. Store at most 200 chat characters and 300 transcript characters per entry, plus decisions and their canonical IDs/timing. Purge within 24 hours at startup and hourly with headroom; cap at 20 MB. Never send diagnostics to a provider, commit them or print their text to the console. Both privacy commands erase the viewer's debug entries and all debug transcript snippets; await disk erasure before confirming. Keep the toggle, clear and download controls available.
- Handle `!optout` before judging. Delete that viewer's quotes and reputation immediately, and exclude them from matching, overlay events, credits and wheel weights. Retain only the minimum stable identifier needed to honor the opt-out.
- Never log OAuth tokens, authorization headers, API keys, raw live chat, raw audio or transcripts. Use sanitized status messages. Do not include secrets in URLs.
- Treat chat and transcripts as untrusted input, never as instructions to the judge.
- Never answer questions or run a conversational chatbot. Send chat messages only for end-of-stream credits, wheel winners, and one confirmation of an explicit `!optout` or `!forgetme` request. Apply the shared rate limiter; quiet mode suppresses credits and winner announcements.
- Keep development mutation endpoints disabled by default; bind locally by default.
- Do not push commits; the owner handles publication.

## Matching and recovery

Filter service accounts and connected streamer/bot IDs before matching. Keep bot recognition separate from moderator or subscriber status. Default to one earliest identical suggestion when repeated text exceeds 12 characters; short reactions such as lol, +1 and f never count. Unique short suggestions remain eligible. Saved settings control confidence (default 0.70, range 0.60–0.90), lookback (default 90 seconds, range 30–180), duplicate policy and an experimental 10-second tail (off by default). Label order explicitly; streamer-first candidates cannot explain earlier actions and only qualify as weak riffs, capped at 0.65. Do not auto-tune from logs or claim causation from overlap.

Bound every audio-pipe wait at 60 seconds and every OpenAI request, including its body read, at 30 seconds. Abort providers and owned capture children on Stop. Keep the health watchdog independent of the main event loop. Its production deadline is 90 seconds; the PowerShell supervisor allows five restarts in ten minutes. Log lag above 500 ms once per minute using numeric status only. Recover retained ledger-only credits into SQLite idempotently after hard exits, without replaying pop-ups or bypassing privacy preferences. Rebuild repository dist only as the final operation when the owner requests that workflow.
