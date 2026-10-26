# Credits Roll

Credits Roll evaluates a Twitch stream transcript alongside chat, credits viewers whose messages changed the stream, shows an OBS pop-up, and rolls end credits. Credited viewers earn reputation for a Channel Points wheel. It never answers chat.

Built from scratch during the Codex x TwitchCon Hackathon, October 23 to November 2, 2026.

## Development

Use Node.js 22 and npm 10 or later.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

## Offline demo

The deterministic demo and setup instructions will be completed in this build.

## Architecture

- `server/`: Fastify, SQLite, chat sources, judging and reputation.
- `overlay/`: Vite, TypeScript and canvas, served by Fastify for OBS.
- `demo/`: synthetic English fixtures; no real viewer data.

## Privacy

Chat and quotes expire within 72 hours. `!optout` removes a viewer's quotes and reputation and prevents future credits. Never log OAuth tokens or API keys. See [AGENTS.md](AGENTS.md) for development rules.
