import type { Viewer } from '../domain.js';
import type { BroadcasterType } from './capabilities.js';
import type { ListeningStatus } from '../live/auto-listen.js';
import type { ForecastView } from '../predictions/types.js';
import type { TranscriptionLanguage } from '../transcript/language.js';

export interface ListeningEnvironment {
  liveEnabled: boolean;
  apiKeyPresent: boolean;
  tools: { streamlink: boolean | null; ffmpeg: boolean | null };
  listening: boolean;
  transcription?: TranscriptionLanguage;
  providers?: {
    errors: number;
    consecutive: number;
    lastStage: string | null;
    lastReason: string | null;
  };
  broadcasterType?: BroadcasterType | null;
  forecast?: ForecastView;
  forecastMoments?: {
    id: string;
    viewer: Viewer;
    quote: string;
    occurredAt: number;
    excluded: boolean;
  }[];
  entriesRefunded?: number;
  status?: ListeningStatus;
  clips?: {
    message: string;
    markerMessage: string;
    attempted: number;
    limit: number;
    pending: number;
  };
}
export const OFFLINE_ENVIRONMENT: ListeningEnvironment = {
  liveEnabled: false,
  apiKeyPresent: false,
  tools: { streamlink: null, ffmpeg: null },
  listening: false,
};
export interface SetupStep {
  id: 'streamer' | 'bot' | 'overlay' | 'listening';
  done: boolean;
  details: string[];
}
export interface SetupInput {
  accounts: Partial<Record<'streamer' | 'bot', Viewer>>;
  oauthConfigured: boolean;
  overlayUrl: string;
  overlayConnected: boolean;
  environment: ListeningEnvironment;
}

export function setupPanel(input: SetupInput) {
  const { streamer, bot } = input.accounts;
  const sameAccount = !!streamer && !!bot && streamer.id === bot.id;
  const missing: string[] = [];
  if (!streamer) missing.push('Connect the streamer account so we know which channel to hear.');
  if (!bot) missing.push('Connect a separate bot account to read chat and send allowed notices.');
  if (sameAccount) missing.push('Streamer and bot must be different Twitch accounts.');
  if (!input.environment.liveEnabled)
    missing.push('Live listening is off. Set CHAT_SOURCE=live and restart for a real stream.');
  if (!input.environment.apiKeyPresent)
    missing.push(
      'OPENAI_API_KEY is missing: live audio needs transcription; the demo needs no key.',
    );
  for (const tool of ['streamlink', 'ffmpeg'] as const) {
    if (input.environment.tools[tool] === false)
      missing.push(
        `${tool} is not installed or not on PATH: live audio capture needs it; the demo works without it. Install it and restart.`,
      );
    else if (input.environment.tools[tool] === null)
      missing.push(`${tool} has not been checked. Enable live listening to check audio tools.`);
  }
  const connectReason = input.oauthConfigured
    ? 'Choose Connect below to authorize Twitch.'
    : 'Twitch login is not configured. Set the Twitch application ID, secret and callback URL, then restart. The demo works without Twitch.';
  const steps: SetupStep[] = [
    {
      id: 'streamer',
      done: !!streamer,
      details: [
        streamer
          ? `Connected @${streamer.login}: this is the channel we listen to.`
          : connectReason,
      ],
    },
    {
      id: 'bot',
      done: !!bot && !sameAccount,
      details: [
        sameAccount
          ? 'The same account is connected twice. Disconnect the bot and choose a different account.'
          : bot
            ? `Connected @${bot.login}: this separate account reads chat and writes allowed notices.`
            : `Use a different Twitch account for the bot. ${connectReason}`,
      ],
    },
    {
      id: 'overlay',
      done: input.overlayConnected,
      details: [
        input.overlayConnected
          ? 'An overlay is connected. Confirm it is visible in OBS; a browser preview also counts as a connection.'
          : 'No overlay is connected. Add the Browser Source below in OBS to show viewer credits on stream.',
      ],
    },
    {
      id: 'listening',
      done: input.environment.listening && missing.length === 0,
      details: missing.length
        ? missing
        : [
            input.environment.listening
              ? 'Listening to live chat and stream audio. Transcript chunks arrive about every 20 seconds.'
              : 'Ready. Go live on Twitch, then choose Start listening. Try the simulation below while offline.',
          ],
    },
  ];
  return { steps, sameAccount, overlayUrl: input.overlayUrl, canStart: missing.length === 0 };
}
