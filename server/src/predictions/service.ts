import type { Moment } from '../domain.js';
import { Store } from '../store/index.js';
import { TwitchApiError } from '../twitch/helix.js';
import { withDeadline } from '../runtime/time.js';
import { FORECAST_RULES } from './types.js';
import type { ForecastView, Prediction, PredictionProvider } from './types.js';

interface ForecastRecord {
  schema: 1;
  streamId: string;
  phase: ForecastView['phase'];
  startedAt: number;
  endsAt: number;
  correctionEndsAt?: number;
  prediction?: Prediction;
  excluded: string[];
  count?: number;
  winner?: string;
  reason?: string;
}
const open = (row: Prediction) => row.status === 'ACTIVE' || row.status === 'LOCKED';
export class ForecastService {
  private record?: ForecastRecord;
  private externalOpen = false;
  private denied = false;
  private message = '';
  private queue = Promise.resolve();
  private ticking?: Promise<void>;
  private lastProbe = -Infinity;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private recovered = false;
  private readonly controller = new AbortController();
  private readonly detachPrivacy: () => void;
  private readonly key: string;
  constructor(
    private readonly options: {
      provider: PredictionProvider;
      store: Store;
      channelId: string;
      streamId: () => string;
      listening: () => boolean;
      eligible: () => boolean;
      scope: () => boolean;
      changed?: (view: ForecastView) => void;
      now?: () => number;
      source?: 'live' | 'demo';
      timer?: boolean;
    },
  ) {
    this.key = `forecast:${options.channelId}`;
    const saved = options.store.getSetting(this.key);
    if (saved) {
      try {
        const value = JSON.parse(saved) as ForecastRecord;
        if (
          value.schema !== 1 ||
          !Array.isArray(value.excluded) ||
          !Number.isFinite(value.startedAt) ||
          !Number.isFinite(value.endsAt)
        )
          throw new Error();
        this.record = value;
      } catch {
        this.record = {
          schema: 1,
          phase: 'uncertain',
          startedAt: this.now(),
          endsAt: this.now(),
          streamId: options.streamId(),
          excluded: [],
          reason:
            'Saved forecast could not be read. Review native predictions in Twitch before trying again.',
        };
        this.message = this.record.reason!;
      }
    }
    this.detachPrivacy = options.store.onOptOut(() => {
      this.pruneExclusions();
      this.persist();
      this.changed();
    });
    if (options.timer !== false) {
      this.timer = setInterval(() => {
        void this.tick();
      }, 1000);
      this.timer.unref();
    }
  }
  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private persist(): void {
    if (this.record) this.options.store.setSetting(this.key, JSON.stringify(this.record));
  }
  private changed(): void {
    this.options.changed?.(this.view());
  }
  private request<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return withDeadline(operation, 10_000, this.controller.signal);
  }
  private moments(): Moment[] {
    const row = this.record;
    return row
      ? this.options.store
          .getMoments(row.streamId)
          .filter((moment) => moment.occurredAt >= row.startedAt && moment.occurredAt < row.endsAt)
      : [];
  }
  private pruneExclusions(): void {
    if (!this.record) return;
    const ids = new Set(this.moments().map((moment) => moment.id));
    this.record.excluded = this.record.excluded.filter((id) => ids.has(id));
  }
  reviewMoments() {
    return this.moments().map((moment) => ({
      id: moment.id,
      viewer: moment.viewer,
      quote: moment.quote,
      occurredAt: moment.occurredAt,
      excluded: this.record!.excluded.includes(moment.id),
    }));
  }
  view(): ForecastView {
    const row = this.record;
    const eligible = this.options.eligible();
    const scope = this.options.scope();
    const active = !!row && !['resolved', 'canceled'].includes(row.phase);
    const count =
      row?.count ?? this.moments().filter((moment) => !row?.excluded.includes(moment.id)).length;
    const message = !eligible
      ? 'Chat forecast needs an Affiliate or Partner channel. Recognition and practice still work.'
      : this.denied
        ? 'Twitch denied predictions. Verify Affiliate/Partner eligibility and reconnect streamer to enable predictions.'
        : !scope
          ? 'Reconnect streamer to enable predictions'
          : this.externalOpen && !active
            ? 'Another Twitch prediction is active or locked. Finish it in Twitch before starting a forecast.'
            : this.message ||
              row?.reason ||
              (!this.options.listening()
                ? 'Start live listening before creating a chat forecast.'
                : 'Ready. Twitch handles all Prediction Channel Points.');
    return {
      phase: row?.phase ?? 'idle',
      visible: eligible && !this.denied,
      canStart:
        eligible &&
        scope &&
        !this.denied &&
        !active &&
        !this.externalOpen &&
        this.options.listening(),
      message,
      count,
      target: FORECAST_RULES.target,
      endsAt: row?.endsAt ?? null,
      correctionEndsAt: row?.correctionEndsAt ?? null,
      proposed:
        row && ['correction', 'resolving', 'resolved'].includes(row.phase)
          ? ((row.phase === 'resolved'
              ? row.prediction?.outcomes.find(
                  (outcome) => outcome.id === row.prediction?.winningOutcomeId,
                )?.title
              : undefined) ?? FORECAST_RULES.outcomes[count >= FORECAST_RULES.target ? 0 : 1])
          : null,
      source: this.options.source ?? 'live',
    };
  }
  private failed(error: unknown): void {
    if (this.closed) return;
    if (error instanceof TwitchApiError && error.status === 403) this.denied = true;
    this.message = this.denied
      ? 'Twitch denied predictions; verify channel eligibility and permission.'
      : 'Forecast update could not be confirmed. Credit is saved. Reconnect streamer if needed; review the native prediction in Twitch.';
    this.changed();
  }
  start(minutes: number = FORECAST_RULES.defaultMinutes): Promise<void> {
    return this.serial(async () => {
      if (
        !Number.isInteger(minutes) ||
        minutes < FORECAST_RULES.minMinutes ||
        minutes > FORECAST_RULES.maxMinutes
      )
        throw new Error('Choose a forecast period from 10 to 60 minutes');
      if (this.closed || !this.view().canStart) throw new Error(this.view().message);
      const existing = await this.request((signal) =>
        this.options.provider.list(this.options.channelId, undefined, signal),
      );
      this.externalOpen = existing.some(open);
      if (this.externalOpen) {
        this.changed();
        throw new Error(
          'Another Twitch prediction is active or locked. Finish it in Twitch first.',
        );
      }
      this.record = {
        schema: 1,
        phase: 'creating',
        startedAt: this.now(),
        endsAt: this.now() + minutes * 60_000,
        streamId: this.options.streamId(),
        excluded: [],
      };
      this.message = 'Creating the native Twitch prediction...';
      this.persist();
      this.changed();
      try {
        const prediction = await this.request((signal) =>
          this.options.provider.create(this.options.channelId, signal),
        );
        if (this.closed) return;
        const interrupted = this.record.phase !== 'creating';
        this.record.prediction = prediction;
        this.record.startedAt = prediction.createdAt;
        this.record.endsAt = prediction.createdAt + minutes * 60_000;
        this.record.phase = interrupted ? 'canceling' : 'counting';
        this.message = interrupted
          ? 'Listening stopped. Canceling the native prediction.'
          : 'Forecast running. Viewers can predict for the first 120 seconds.';
        this.persist();
        this.changed();
      } catch (error) {
        if (this.closed) return;
        this.record.phase = 'uncertain';
        this.record.reason =
          'Creation is unconfirmed. Review Twitch; this app will not create a duplicate.';
        this.persist();
        this.failed(error);
        throw new Error('Forecast creation could not be confirmed. Review Twitch before retrying.');
      }
    }).catch((error) => {
      this.failed(error);
      throw error;
    });
  }
  /** Called only after credit persistence. It does not wait for a remote request. */
  credit(): void {
    if (!this.closed) this.changed();
  }
  exclude(momentId: string, excluded = true): void {
    const row = this.record;
    if (!row || row.phase !== 'correction' || this.now() >= row.correctionEndsAt!)
      throw new Error('Forecast corrections are available only during its 120-second review');
    if (!this.moments().some((moment) => moment.id === momentId))
      throw new Error('Credit is not in this forecast');
    row.excluded = row.excluded.filter((id) => id !== momentId);
    if (excluded) row.excluded.push(momentId);
    this.persist();
    this.changed();
  }
  interrupt(reason = 'Listening stopped before the forecast period ended.'): void {
    const row = this.record;
    if (
      !row ||
      (row.phase !== 'creating' && !(row.phase === 'counting' && this.now() < row.endsAt))
    )
      return;
    row.phase = row.prediction ? 'canceling' : 'uncertain';
    row.reason = reason;
    this.message = reason + ' Twitch cancellation/refund is pending confirmation.';
    this.persist();
    this.changed();
    void this.tick(true);
  }
  cancel(): Promise<void> {
    const row = this.record;
    if (!row || !['counting', 'correction', 'canceling'].includes(row.phase))
      return Promise.reject(new Error('There is no cancelable forecast'));
    row.phase = 'canceling';
    row.reason = 'Canceled by the streamer.';
    this.persist();
    this.changed();
    return this.tick(true);
  }
  async recover(): Promise<void> {
    if (this.closed) return;
    if (this.recovered) {
      await this.tick(true);
      return;
    }
    this.recovered = true;
    if (this.record?.phase === 'creating') {
      this.record.phase = 'uncertain';
      this.persist();
    }
    if (this.record?.phase === 'counting' && this.now() < this.record.endsAt)
      this.interrupt('Server restarted during the forecast period.');
    await this.tick(true);
  }
  authorizationChanged(): void {
    this.denied = false;
    this.message = '';
    void this.tick(true);
  }
  tick(force = false): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.ticking) return this.ticking;
    this.ticking = this.serial(() => this.advance(force))
      .catch((error) => this.failed(error))
      .finally(() => {
        this.ticking = undefined;
      });
    return this.ticking;
  }
  private async advance(force: boolean): Promise<void> {
    if (this.closed || !this.options.eligible() || !this.options.scope() || this.denied) return;
    const row = this.record;
    if (row?.phase === 'counting' && this.now() < row.endsAt && !this.options.listening()) {
      row.phase = 'canceling';
      row.reason = 'Listening was interrupted before the forecast period ended.';
      this.persist();
    }
    const due =
      row &&
      (['canceling', 'resolving'].includes(row.phase) ||
        (row.phase === 'counting' &&
          (this.now() >= row.endsAt ||
            (row.prediction?.status === 'ACTIVE' &&
              this.now() >= row.startedAt + FORECAST_RULES.bettingSeconds * 1000))) ||
        (row.phase === 'correction' && this.now() >= row.correctionEndsAt!));
    if (!force && !due && this.now() - this.lastProbe < 15_000) return;
    this.lastProbe = this.now();
    const terminal = row && ['resolved', 'canceled'].includes(row.phase);
    const predictions = await this.request((signal) =>
      this.options.provider.list(
        this.options.channelId,
        terminal ? undefined : row?.prediction?.id,
        signal,
      ),
    );
    if (this.closed) return;
    this.externalOpen = predictions.some(open);
    if (terminal) {
      this.changed();
      return;
    }
    if (!row) {
      this.message = '';
      this.changed();
      return;
    }
    if (!row.prediction) {
      if (!this.externalOpen && this.now() - row.startedAt > 60_000) {
        row.phase = 'canceled';
        this.message = 'No open prediction found. Unconfirmed creation was not retried.';
        this.persist();
      } else
        this.message =
          'Unconfirmed forecast creation. Review and cancel any native prediction in Twitch before trying again.';
      this.changed();
      return;
    }
    const remote = predictions.find((item) => item.id === row.prediction!.id);
    if (!remote) throw new Error('Saved prediction is unavailable; review Twitch');
    row.prediction = remote;
    if (!open(remote)) {
      row.phase = remote.status === 'RESOLVED' ? 'resolved' : 'canceled';
      row.count ??= this.moments().filter((moment) => !row.excluded.includes(moment.id)).length;
      row.excluded = [];
      this.message =
        remote.status === 'RESOLVED'
          ? 'Native prediction resolved. Twitch handles the points; check the outcome in Twitch.'
          : 'Native prediction canceled. Twitch handles the participant refunds.';
      this.persist();
      this.changed();
      return;
    }
    if (row.phase === 'canceling') {
      row.prediction = await this.request((signal) =>
        this.options.provider.update(
          this.options.channelId,
          remote.id,
          'CANCELED',
          undefined,
          signal,
        ),
      );
      row.phase = 'canceled';
      row.excluded = [];
      this.externalOpen = false;
      this.message = 'Native prediction canceled. Twitch handles the participant refunds.';
      this.persist();
      this.changed();
      return;
    }
    if (
      remote.status === 'ACTIVE' &&
      this.now() >= row.startedAt + FORECAST_RULES.bettingSeconds * 1000
    ) {
      row.prediction = await this.request((signal) =>
        this.options.provider.update(
          this.options.channelId,
          remote.id,
          'LOCKED',
          undefined,
          signal,
        ),
      );
    }
    if (row.phase === 'counting' && this.now() >= row.endsAt) {
      row.phase = 'correction';
      row.correctionEndsAt = this.now() + FORECAST_RULES.correctionSeconds * 1000;
      this.message =
        'Proposed result ready. You have 120 seconds to exclude a mistaken credit or cancel.';
      this.persist();
      this.changed();
      return;
    }
    if (row.phase === 'correction' && this.now() >= row.correctionEndsAt!) {
      row.count = this.moments().filter((moment) => !row.excluded.includes(moment.id)).length;
      row.winner = row.prediction.outcomes[row.count >= FORECAST_RULES.target ? 0 : 1]!.id;
      row.phase = 'resolving';
      this.persist();
    }
    if (row.phase === 'resolving') {
      row.prediction = await this.request((signal) =>
        this.options.provider.update(
          this.options.channelId,
          remote.id,
          'RESOLVED',
          row.winner,
          signal,
        ),
      );
      row.phase = 'resolved';
      row.excluded = [];
      this.externalOpen = false;
      this.message =
        'Native prediction resolved. Twitch distributes points to the viewers who predicted correctly.';
    } else if (row.phase === 'counting')
      this.message =
        'Forecast running. Betting locks after 120 seconds; the measurement period continues.';
    this.persist();
    this.changed();
  }
  async close(cancelAll = false): Promise<void> {
    if (this.closed) return;
    if (cancelAll && this.record?.phase === 'correction') {
      this.record.phase = 'canceling';
      this.record.excluded = [];
      this.persist();
    }
    this.interrupt('Server stopped during the forecast period.');
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.detachPrivacy();
    this.controller.abort();
    const row = this.record;
    if (row?.phase === 'canceling' && row.prediction) {
      try {
        row.prediction = await withDeadline(
          (signal) =>
            this.options.provider.update(
              this.options.channelId,
              row.prediction!.id,
              'CANCELED',
              undefined,
              signal,
            ),
          3000,
        );
        row.phase = 'canceled';
        row.excluded = [];
        this.persist();
      } catch {
        /* Durable cancel intent is retried after restart. Never claim an unconfirmed refund. */
      }
    }
  }
}
