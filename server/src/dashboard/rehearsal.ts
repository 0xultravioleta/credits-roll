import { randomUUID } from 'node:crypto';
import { FakeEmbeddings, FakeTranscriber } from '../ai/fake.js';
import type { ChatMessage } from '../domain.js';
import { OverlayHub } from '../events/hub.js';
import { FakeJudge } from '../matcher/fake-judge.js';
import { Matcher, LOOKBACK_MS } from '../matcher/index.js';
import { Pipeline } from '../pipeline.js';
import { drawWheel, Scoring } from '../scoring/index.js';
import { Store } from '../store/index.js';
import { DashboardState } from './state.js';
import { MemoryCreditLedger } from '../ledger/index.js';

export class DashboardRehearsal {
  private readonly store: Store;
  private readonly scoring: Scoring;
  private readonly pipeline: Pipeline;
  private readonly streamId = `practice-${randomUUID()}`;
  private pending?: ChatMessage;
  constructor(
    private readonly hub: OverlayHub,
    private readonly dashboard: DashboardState,
    private readonly now: () => number = Date.now,
  ) {
    this.store = new Store(':memory:', now);
    this.scoring = new Scoring(this.store, new MemoryCreditLedger(), () => ({
      channelId: 'practice',
      judgeModel: 'fake',
    }));
    this.store.startRetentionJob();
    this.pipeline = new Pipeline({
      store: this.store,
      hub,
      scoring: this.scoring,
      matcher: new Matcher(new FakeJudge(), new FakeEmbeddings()),
      transcriber: new FakeTranscriber(),
      now,
      onTranscript: (window) => dashboard.transcript(window),
      onChat: (message) => dashboard.chat(message),
    });
  }
  get active(): boolean {
    return this.hub.snapshot().streamId === this.streamId;
  }
  chat() {
    if (!this.active) {
      this.pipeline.clearChat();
      this.store.clearChannelData();
      this.pending = undefined;
      this.dashboard.clearTranscripts();
      this.dashboard.setWinner(undefined);
    }
    if (!this.active || this.hub.snapshot().phase !== 'live')
      this.hub.showRehearsal(this.store, this.scoring, this.streamId);
    if (!this.pending || this.pending.sentAt < this.now() - LOOKBACK_MS) {
      this.pipeline.clearChat();
      this.pending = {
        id: randomUUID(),
        viewer: { id: 'practice:mapmaker', login: 'mapmaker' },
        text: 'Try the northern bridge',
        sentAt: this.now(),
      };
      this.pipeline.addChat(this.pending);
    }
    return {
      message:
        'Chat added: @mapmaker: Try the northern bridge. Now simulate the streamer speaking.',
    };
  }
  async speech() {
    if (!this.active || !this.pending || this.pending.sentAt < this.now() - LOOKBACK_MS)
      return {
        error:
          'Choose Simulate a viewer message first, then simulate the streamer within 90 seconds.',
      };
    const endAt = this.now();
    const moments = await this.pipeline.processAudioWindow(
      { id: randomUUID(), streamId: this.streamId, startAt: endAt, endAt },
      {
        bytes: new TextEncoder().encode("Good idea, I'm going to try the northern bridge."),
        filename: 'synthetic.txt',
        mimeType: 'text/plain',
      },
    );
    this.pending = undefined;
    this.pipeline.clearChat();
    return {
      moments,
      message:
        'Moment found: @mapmaker moved the stream. Watch the overlay pop-up and the counters.',
    };
  }
  credits() {
    if (!this.active)
      return { error: 'Simulate a viewer message and the streamer speaking first.' };
    this.hub.rollCredits(this.streamId);
    return {
      message: 'Practice end credits are rolling on the overlay. Nothing was sent to Twitch.',
    };
  }
  spin() {
    if (!this.active)
      return { error: 'Find a practice moment first so the wheel has a credited viewer.' };
    const winner = drawWheel(this.scoring.wheelEntries(), () => 0);
    if (!winner)
      return { error: 'The practice wheel has no credited viewers. Simulate both parts first.' };
    this.dashboard.setWinner(winner.viewer);
    return {
      winner,
      message: `Practice winner: @${winner.viewer.login}. No Channel Points used; nothing sent to Twitch.`,
    };
  }
  close(): void {
    this.pipeline.close();
    this.store.close();
  }
}
