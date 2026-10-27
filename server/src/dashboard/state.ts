import type { ChatMessage, Moment, TranscriptWindow, Viewer } from '../domain.js';
import { Store } from '../store/index.js';
import type { AccountRole } from '../auth/types.js';
import { DEFAULT_IGNORED_LOGINS, parseIgnoredLogins } from '../twitch/bot-filter.js';
import { MATCH_RULES, DEFAULT_MATCH_OPTIONS } from '../matcher/rules.js';
import type { MatchOptions } from '../matcher/rules.js';
import { allowedPrize, WHEEL_PRIZES } from '../wheel/prizes.js';

export interface Settings extends MatchOptions {
  language: 'en' | 'es';
  confidenceThreshold: number;
  prizeText: string;
  quietMode: boolean;
  wheelEnabled: boolean;
  ignoredLogins: string[];
  debugLog: boolean;
  autoListen: boolean;
  clipsEnabled: boolean;
  creditedViewersEnterFree: boolean;
}
export interface DashboardActions {
  settingsChanged?(settings: Settings): Promise<void>;
  settingsSaved?(): Promise<void>;
  rollCredits?(): Promise<unknown>;
  spinWheel?(): Promise<unknown>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  disconnect?(role?: AccountRole): Promise<void>;
  startForecast?(minutes: number): Promise<void>;
  cancelForecast?(): Promise<void>;
  correctForecast?(momentId: string, excluded: boolean): Promise<void>;
}
export interface ActivityEntry {
  id: number;
  text: string;
  receivedAt: number;
  viewerId?: string;
}
export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  confidenceThreshold: MATCH_RULES.defaultConfidence,
  prizeText: WHEEL_PRIZES[0],
  quietMode: true,
  wheelEnabled: false,
  ignoredLogins: [...DEFAULT_IGNORED_LOGINS],
  debugLog: true,
  autoListen: true,
  clipsEnabled: true,
  creditedViewersEnterFree: true,
  ...DEFAULT_MATCH_OPTIONS,
};

export function parseSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw new Error('Invalid settings');
  const row = input as Record<string, unknown>;
  const lookbackSeconds = row.lookbackSeconds ?? DEFAULT_MATCH_OPTIONS.lookbackSeconds;
  const duplicatePolicy = row.duplicatePolicy ?? DEFAULT_MATCH_OPTIONS.duplicatePolicy;
  const allowAfterReply = row.allowAfterReply ?? false;
  if (
    typeof lookbackSeconds !== 'number' ||
    !Number.isInteger(lookbackSeconds) ||
    lookbackSeconds < MATCH_RULES.minLookbackSeconds ||
    lookbackSeconds > MATCH_RULES.maxLookbackSeconds ||
    !['keep-first', 'reject-all'].includes(String(duplicatePolicy)) ||
    typeof allowAfterReply !== 'boolean'
  )
    throw new Error('Invalid matching settings');
  const debugLog = row.debugLog ?? true;
  const autoListen = row.autoListen ?? true;
  const clipsEnabled = row.clipsEnabled ?? true;
  const creditedViewersEnterFree = row.creditedViewersEnterFree ?? true;
  if (typeof creditedViewersEnterFree !== 'boolean')
    throw new Error('Invalid credited entry setting');
  if (typeof clipsEnabled !== 'boolean') throw new Error('Invalid clip setting');
  if (typeof autoListen !== 'boolean') throw new Error('Invalid auto-listen setting');
  if (typeof debugLog !== 'boolean') throw new Error('Invalid debug setting');
  const ignoredLogins = row.ignoredLogins ?? DEFAULT_IGNORED_LOGINS;
  if (!Array.isArray(ignoredLogins) || ignoredLogins.some((value) => typeof value !== 'string'))
    throw new Error('Invalid ignored logins');
  if (
    !['en', 'es'].includes(String(row.language)) ||
    typeof row.confidenceThreshold !== 'number' ||
    !Number.isFinite(row.confidenceThreshold) ||
    row.confidenceThreshold < MATCH_RULES.minConfidence ||
    row.confidenceThreshold > MATCH_RULES.maxThreshold ||
    !allowedPrize(row.prizeText) ||
    typeof row.quietMode !== 'boolean' ||
    typeof row.wheelEnabled !== 'boolean' ||
    Object.keys(row).some((key) => !(key in DEFAULT_SETTINGS))
  )
    throw new Error('Invalid settings');
  return {
    language: row.language as Settings['language'],
    confidenceThreshold: row.confidenceThreshold,
    prizeText: row.prizeText,
    quietMode: row.quietMode,
    wheelEnabled: row.wheelEnabled,
    ignoredLogins: parseIgnoredLogins(ignoredLogins),
    debugLog,
    autoListen,
    clipsEnabled,
    creditedViewersEnterFree,
    lookbackSeconds,
    duplicatePolicy: duplicatePolicy as Settings['duplicatePolicy'],
    allowAfterReply,
  };
}

export class DashboardState {
  private readonly timer: ReturnType<typeof setInterval>;
  private transcripts: { window: TranscriptWindow; receivedAt: number }[] = [];
  private settings: Settings;
  private status = 'Idle. Connect both accounts, then start listening.';
  private winner?: Viewer;
  private replayRunning = false;
  private activity: ActivityEntry[] = [];
  private activityId = 0;
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {
    const saved = store.getSetting('settings');
    const prior = saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    this.settings = parseSettings({
      ...prior,
      prizeText: allowedPrize(prior.prizeText) ? prior.prizeText : WHEEL_PRIZES[0],
      confidenceThreshold: Math.min(
        MATCH_RULES.maxThreshold,
        Math.max(MATCH_RULES.minConfidence, prior.confidenceThreshold),
      ),
    });
    if (saved && prior.prizeText !== this.settings.prizeText)
      store.setSetting('settings', JSON.stringify(this.settings));
    this.timer = setInterval(() => this.prune(), 15_000);
    this.timer.unref();
  }
  getSettings(): Settings {
    return { ...this.settings, ignoredLogins: [...this.settings.ignoredLogins] };
  }
  saveSettings(input: unknown): Settings {
    const next = parseSettings(input);
    this.store.setSetting('settings', JSON.stringify(next));
    this.settings = next;
    return this.getSettings();
  }
  setStatus(message: string): void {
    this.status = message;
  }
  getStatus(): string {
    return this.status;
  }
  setReplayRunning(running: boolean): void {
    this.replayRunning = running;
  }
  isReplayRunning(): boolean {
    return this.replayRunning;
  }
  setWinner(viewer?: Viewer): void {
    this.winner = viewer;
  }
  getWinner(): Viewer | null {
    return this.winner && !this.store.isOptedOut(this.winner.id) ? this.winner : null;
  }
  transcript(window: TranscriptWindow): void {
    this.prune();
    this.transcripts.push({
      window: { ...window, text: window.text.slice(0, 16_000) },
      receivedAt: this.now(),
    });
    this.transcripts = this.transcripts.slice(-8);
    this.note(`Heard the streamer: ${window.text.slice(0, 16_000)}`);
  }
  chat(message: ChatMessage): void {
    if (!this.store.isOptedOut(message.viewer.id))
      this.note(`Chat: @${message.viewer.login}: ${message.text.slice(0, 500)}`, message.viewer.id);
  }
  moment(moment: Moment): void {
    if (!this.store.isOptedOut(moment.viewer.id))
      this.note(
        `Moment found: @${moment.viewer.login} moved the stream: ${moment.quote.slice(0, 500)}`,
        moment.viewer.id,
      );
  }
  getActivity(): ActivityEntry[] {
    this.prune();
    return this.activity.filter((row) => !row.viewerId || !this.store.isOptedOut(row.viewerId));
  }
  private note(text: string, viewerId?: string): void {
    this.prune();
    this.activity.push({ id: ++this.activityId, text, receivedAt: this.now(), viewerId });
    this.activity = this.activity.slice(-40);
  }
  getTranscripts(): TranscriptWindow[] {
    this.prune();
    return this.transcripts.map((row) => row.window);
  }
  clearTranscripts(): void {
    this.transcripts = [];
    this.activity = [];
  }
  close(): void {
    clearInterval(this.timer);
    this.clearTranscripts();
  }
  private prune(): void {
    this.transcripts = this.transcripts.filter((row) => row.receivedAt > this.now() - 90_000);
    this.activity = this.activity.filter((row) => row.receivedAt > this.now() - 90_000);
  }
}
