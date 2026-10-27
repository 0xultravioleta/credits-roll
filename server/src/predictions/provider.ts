import type { TwitchApi } from '../twitch/helix.js';
import { object, text } from '../twitch/source.js';
import { FORECAST_RULES } from './types.js';
import type { Prediction, PredictionProvider, PredictionStatus } from './types.js';

function parse(value: unknown, channelId: string): Prediction {
  const row = object(value);
  const outcomes = Array.isArray(row.outcomes) ? row.outcomes.map((value) => object(value)) : [];
  if (
    !text(row.id, 128) ||
    row.broadcaster_id !== channelId ||
    !text(row.title, 45) ||
    !['ACTIVE', 'LOCKED', 'RESOLVED', 'CANCELED'].includes(String(row.status)) ||
    typeof row.created_at !== 'string' ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    outcomes.length < 2 ||
    outcomes.length > 10 ||
    outcomes.some((outcome) => !text(outcome.id, 128) || !text(outcome.title, 25))
  )
    throw new Error('Invalid Twitch prediction response');
  return {
    id: row.id,
    channelId,
    title: row.title,
    status: row.status as PredictionStatus,
    createdAt: Date.parse(row.created_at),
    outcomes: outcomes.map((outcome) => ({ id: String(outcome.id), title: String(outcome.title) })),
    ...(typeof row.winning_outcome_id === 'string'
      ? { winningOutcomeId: row.winning_outcome_id }
      : {}),
  };
}
export class HelixPredictionProvider implements PredictionProvider {
  constructor(private readonly api: TwitchApi) {}
  async list(channelId: string, id?: string, signal?: AbortSignal): Promise<Prediction[]> {
    const result = object(
      await this.api.request('streamer', 'predictions', {
        query: { broadcaster_id: channelId, ...(id ? { id } : { first: '20' }) },
        signal,
      }),
    );
    if (!Array.isArray(result.data)) throw new Error('Invalid Twitch prediction list');
    return result.data.map((value) => parse(value, channelId));
  }
  async create(channelId: string, signal?: AbortSignal): Promise<Prediction> {
    const result = object(
      await this.api.request('streamer', 'predictions', {
        method: 'POST',
        signal,
        body: {
          broadcaster_id: channelId,
          title: FORECAST_RULES.title,
          outcomes: FORECAST_RULES.outcomes.map((title) => ({ title })),
          prediction_window: FORECAST_RULES.bettingSeconds,
        },
      }),
    );
    const prediction = parse(Array.isArray(result.data) ? result.data[0] : undefined, channelId);
    if (
      prediction.title !== FORECAST_RULES.title ||
      prediction.outcomes.length !== 2 ||
      prediction.outcomes.some((value, index) => value.title !== FORECAST_RULES.outcomes[index])
    )
      throw new Error('Unexpected Twitch forecast outcomes');
    return prediction;
  }
  async update(
    channelId: string,
    id: string,
    status: Exclude<PredictionStatus, 'ACTIVE'>,
    winningOutcomeId?: string,
    signal?: AbortSignal,
  ): Promise<Prediction> {
    if (
      !['LOCKED', 'RESOLVED', 'CANCELED'].includes(status) ||
      (status === 'RESOLVED' && !winningOutcomeId)
    )
      throw new Error('Invalid prediction transition');
    const result = object(
      await this.api.request('streamer', 'predictions', {
        method: 'PATCH',
        signal,
        body: {
          broadcaster_id: channelId,
          id,
          status,
          ...(status === 'RESOLVED' ? { winning_outcome_id: winningOutcomeId } : {}),
        },
      }),
    );
    const prediction = parse(Array.isArray(result.data) ? result.data[0] : undefined, channelId);
    if (
      prediction.id !== id ||
      prediction.status !== status ||
      (status === 'RESOLVED' && prediction.winningOutcomeId !== winningOutcomeId)
    )
      throw new Error('Unexpected Twitch prediction transition');
    return prediction;
  }
}

/** No Channel Points, bettors, payout claims or network calls. */
export class FakePredictionProvider implements PredictionProvider {
  readonly predictions: Prediction[] = [];
  constructor(private readonly now: () => number = Date.now) {}
  async list(channelId: string, id?: string): Promise<Prediction[]> {
    return structuredClone(
      this.predictions.filter((row) => row.channelId === channelId && (!id || row.id === id)),
    );
  }
  async create(channelId: string): Promise<Prediction> {
    if (
      this.predictions.some(
        (row) => row.channelId === channelId && ['ACTIVE', 'LOCKED'].includes(row.status),
      )
    )
      throw new Error('Another prediction is open');
    const row: Prediction = {
      id: `demo-forecast-${this.predictions.length + 1}`,
      channelId,
      title: FORECAST_RULES.title,
      createdAt: this.now(),
      status: 'ACTIVE',
      outcomes: FORECAST_RULES.outcomes.map((title, index) => ({
        id: `demo-outcome-${index}`,
        title,
      })),
    };
    this.predictions.unshift(row);
    return structuredClone(row);
  }
  async update(
    channelId: string,
    id: string,
    status: Exclude<PredictionStatus, 'ACTIVE'>,
    winningOutcomeId?: string,
  ): Promise<Prediction> {
    const row = this.predictions.find((row) => row.id === id && row.channelId === channelId);
    if (
      !row ||
      !['ACTIVE', 'LOCKED'].includes(row.status) ||
      (row.status === 'LOCKED' && status === 'LOCKED') ||
      (status === 'RESOLVED' && !row.outcomes.some((outcome) => outcome.id === winningOutcomeId))
    )
      throw new Error('Invalid fake prediction transition');
    row.status = status;
    row.winningOutcomeId = status === 'RESOLVED' ? winningOutcomeId : undefined;
    return structuredClone(row);
  }
}
