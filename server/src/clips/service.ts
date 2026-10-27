import type { Moment } from '../domain.js';
import type { MemoryCreditLedger } from '../ledger/index.js';
import type { Store } from '../store/index.js';
import { TwitchApiError } from '../twitch/helix.js';
import { abortableDelay, OperationTimeout, withDeadline } from '../runtime/time.js';
import { CLIP_RULES, clipTitle } from './types.js';
import type { ClipProvider, MomentMedia, PublishedClip } from './types.js';

interface Budget {
  count: number;
  restricted: boolean;
}
export class ClipService {
  private readonly jobs = new Map<
    string,
    { viewerId: string; controller: AbortController; task: Promise<void> }
  >();
  private message = 'Clips wait for a new live credit. Markers need VOD storage.';
  private markerMessage =
    'Markers need VOD storage; availability is checked when a marker is created.';
  constructor(
    private readonly options: {
      provider: ClipProvider;
      ledger: MemoryCreditLedger;
      store: Store;
      channelId: string;
      streamId: () => string;
      live: () => boolean;
      enabled: () => boolean;
      scopes: () => readonly string[];
      onReady: (moment: Moment, clip: PublishedClip) => void;
      announce?: (moment: Moment, clip: PublishedClip, signal: AbortSignal) => Promise<void>;
      allowDemo?: boolean;
      now?: () => number;
    },
  ) {}
  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private budgetKey(streamId: string): string {
    return `clips:budget:${this.options.channelId}:${streamId}`;
  }
  private budget(streamId: string): Budget {
    const saved = this.options.store.getSetting(this.budgetKey(streamId));
    return saved ? (JSON.parse(saved) as Budget) : { count: 0, restricted: false };
  }
  status() {
    const budget = this.budget(this.options.streamId());
    return {
      message: budget.restricted
        ? 'Twitch returned 403: clips are restricted or disabled. Clips stay off for this stream; credit still works.'
        : this.message,
      markerMessage: this.markerMessage,
      attempted: budget.count,
      limit: CLIP_RULES.perStream,
      pending: this.jobs.size,
    };
  }
  private clipPermission(streamId: string): string | null {
    if (!this.options.scopes().includes('clips:edit')) return 'Reconnect streamer to enable clips';
    if (this.options.provider.mode === 'demo') return null;
    const budget = this.budget(streamId);
    if (budget.restricted) return 'Clips are restricted for this stream.';
    if (budget.count >= CLIP_RULES.perStream) return 'The 20-clip stream limit has been reached.';
    const last = Number(
      this.options.store.getSetting(`clips:last:${this.options.channelId}`) ?? -Infinity,
    );
    if (this.now() - last < CLIP_RULES.cooldownMs)
      return 'Clip skipped: one clip per 60 seconds. Credit and marker still work.';
    this.options.store.transaction(() => {
      this.options.store.setSetting(
        this.budgetKey(streamId),
        JSON.stringify({ ...budget, count: budget.count + 1 }),
      );
      this.options.store.setSetting(`clips:last:${this.options.channelId}`, String(this.now()));
    });
    return null;
  }
  credit(moment: Moment): void {
    if (
      !this.options.enabled() ||
      this.options.store.isOptedOut(moment.viewer.id) ||
      this.jobs.has(moment.id) ||
      moment.streamId !== this.options.streamId() ||
      (this.options.provider.mode === 'live' ? !this.options.live() : !this.options.allowDemo)
    )
      return;
    const row = this.options.ledger.get(moment.id);
    if (!row || row.media || this.jobs.size >= 20) return;
    const reason = this.clipPermission(moment.streamId);
    const media: MomentMedia = {
      clip: {
        status: reason ? 'skipped' : 'creating',
        named: false,
        requestedAt: this.now(),
        demo: this.options.provider.mode === 'demo',
      },
    };
    if (reason) this.message = reason;
    this.options.ledger.updateMedia(moment.id, media);
    const controller = new AbortController();
    // Queue after installing the cancellation handle. Never await this work in the matcher.
    const task = Promise.resolve()
      .then(() => this.run(moment, media, reason, controller.signal))
      .catch(() => {
        this.message = 'Media could not be saved or requested. Credit remains recorded.';
      })
      .finally(() => this.jobs.delete(moment.id));
    this.jobs.set(moment.id, { viewerId: moment.viewer.id, controller, task });
  }
  private valid(moment: Moment, signal: AbortSignal): boolean {
    return (
      !signal.aborted &&
      !this.options.store.isOptedOut(moment.viewer.id) &&
      !!this.options.ledger.get(moment.id)
    );
  }
  private save(moment: Moment, media: MomentMedia): void {
    if (!this.options.store.isOptedOut(moment.viewer.id))
      this.options.ledger.updateMedia(moment.id, media);
  }
  private async run(
    moment: Moment,
    media: MomentMedia,
    reason: string | null,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.valid(moment, signal)) return;
    await Promise.allSettled([
      reason ? Promise.resolve() : this.createClip(moment, media, signal),
      this.createMarker(moment, media, signal),
    ]);
  }
  private async createMarker(
    moment: Moment,
    media: MomentMedia,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.options.scopes().includes('channel:manage:broadcast')) {
      media.marker = { status: 'missing-scope' };
      this.markerMessage = 'Reconnect streamer to enable stream markers';
      this.save(moment, media);
      return;
    }
    try {
      const marker = await withDeadline(
        (deadline) =>
          this.options.provider.marker(
            this.options.channelId,
            (this.options.store.isOptedOut(moment.viewer.id)
              ? 'A viewer'
              : '@' + moment.viewer.login) +
              ': ' +
              moment.kind,
            deadline,
          ),
        10_000,
        signal,
      );
      if (!this.valid(moment, signal)) return;
      media.marker = { ...marker, status: 'ready' };
      this.markerMessage =
        'VOD marker created. Open Twitch Video Producer / Highlighter to use its position.';
    } catch (error) {
      if (signal.aborted) return;
      media.marker = {
        status: error instanceof TwitchApiError && error.status === 404 ? 'needs-vod' : 'failed',
      };
      this.markerMessage =
        media.marker.status === 'needs-vod'
          ? 'Markers need VOD storage. Twitch returned 404; verify VOD storage and that the channel is live.'
          : 'Marker could not be created. Check streamer permission and VOD storage; credit still works.';
    }
    this.save(moment, media);
  }
  private async createClip(moment: Moment, media: MomentMedia, signal: AbortSignal): Promise<void> {
    try {
      const created = await withDeadline(
        (deadline) => {
          if (!this.valid(moment, signal)) throw new Error('Credit removed');
          media.clip.named = !this.options.store.isOptedOut(moment.viewer.id);
          this.save(moment, media);
          return this.options.provider.create(
            this.options.channelId,
            clipTitle(media.clip.named ? moment.viewer.login : undefined, moment.kind),
            deadline,
          );
        },
        10_000,
        signal,
      );
      if (!this.valid(moment, signal)) return;
      media.clip = { ...media.clip, id: created.id, status: 'confirming' };
      this.save(moment, media);
      let clip: PublishedClip | null = null;
      try {
        clip = await withDeadline(
          async (deadline) => {
            for (let poll = 0; poll < CLIP_RULES.confirmMs / CLIP_RULES.pollMs; poll++) {
              if (this.options.provider.mode !== 'demo')
                await abortableDelay(CLIP_RULES.pollMs, deadline);
              const found = await this.options.provider.get(created.id, deadline);
              if (found) return found;
            }
            return null;
          },
          CLIP_RULES.confirmMs,
          signal,
        );
      } catch (error) {
        if (!(error instanceof OperationTimeout)) throw error;
      }
      if (!this.valid(moment, signal)) return;
      media.clip = {
        ...media.clip,
        ...(clip ?? {}),
        status: clip ? 'ready' : 'pending-unconfirmed',
      };
      this.save(moment, media);
      this.message = clip
        ? 'Clip confirmed. Credit remains recorded even if a later announcement fails.'
        : 'Clip pending-unconfirmed after 60 seconds. Check Creator Dashboard → Clips; the app will not create another for this credit.';
      if (clip) {
        this.options.onReady({ ...moment, media }, clip);
        if (this.valid(moment, signal) && this.options.provider.mode === 'live')
          await withDeadline(
            (deadline) => this.options.announce?.(moment, clip!, deadline) ?? Promise.resolve(),
            10_000,
            signal,
          ).catch(() => {
            this.message =
              'Clip confirmed, but the chat announcement failed. Check bot authorization; credit remains recorded.';
          });
      }
    } catch (error) {
      const accepted = !!media.clip.id;
      if (signal.aborted) {
        if (['creating', 'confirming'].includes(media.clip.status)) {
          media.clip.status = 'pending-unconfirmed';
          this.save(moment, media);
        }
        return;
      }
      if (error instanceof TwitchApiError && error.status === 403) {
        media.clip.status = 'restricted';
        const budget = this.budget(moment.streamId);
        this.options.store.setSetting(
          this.budgetKey(moment.streamId),
          JSON.stringify({ ...budget, restricted: true }),
        );
        this.message = 'Twitch returned 403: clips disabled for this stream. Credit still works.';
      } else if (error instanceof TwitchApiError && error.status === 404 && !accepted) {
        media.clip.status = 'offline';
        this.message = 'Clip skipped: Twitch says the channel is offline. Credit remains recorded.';
      } else {
        if (media.clip.status !== 'ready') media.clip.status = 'failed';
        this.message =
          'Clip request, confirmation or announcement failed. Credit remains recorded; inspect the saved clip status.';
      }
      if (!accepted && error instanceof TwitchApiError) media.clip.named = false;
      this.save(moment, media);
    }
  }
  forget(viewerId: string): void {
    for (const job of this.jobs.values()) if (job.viewerId === viewerId) job.controller.abort();
  }
  async stop(): Promise<void> {
    for (const job of this.jobs.values()) job.controller.abort();
    await this.drain();
  }
  async drain(): Promise<void> {
    await Promise.allSettled([...this.jobs.values()].map((job) => job.task));
  }
}
