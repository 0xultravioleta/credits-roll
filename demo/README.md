# Synthetic rehearsal

All names, messages and transcript lines are fictional and were written for this hackathon. These files are not real Twitch recordings. Relative timestamps make replay repeatable.

`chat.jsonl` contains normalized chat with millisecond offsets. `transcript.jsonl` contains matching spoken-response windows. The fake transcriber decodes UTF-8 transcript fixtures; it does not perform speech recognition. OpenAI transcription accepts actual audio chunks through the same `Transcriber` interface.

Expected results: five moments from four viewers. `mapmaker` contributes two ideas, `switchwitch` gives a gameplay assist, `punpilot` starts a running joke, and `mixcraft` fixes the audio. The greeting and question earn no credit. `quietartist` opts out before the response and is excluded from credits, reputation and the wheel.

Run `npm run demo` for a roughly 48-second rehearsal followed by end credits. The server remains running so you can open the overlay afterward; new connections receive the credits state. Use `npm run demo -- --once` for a fast, finite offline smoke run. The demo always uses an in-memory database and fakes, even if credentials are present in the environment.
