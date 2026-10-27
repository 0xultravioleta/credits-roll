import type { ForecastView } from '../../server/src/predictions/types.js';
export function forecastCard(
  forecast: ForecastView | null | undefined,
  now: number,
): string | null {
  if (!forecast?.visible || !['counting', 'correction'].includes(forecast.phase)) return null;
  const deadline = forecast.phase === 'correction' ? forecast.correctionEndsAt : forecast.endsAt;
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return `${forecast.source === 'demo' ? 'Demo forecast' : 'Chat forecast'} ${forecast.count}/${forecast.target} · ${clock} ${forecast.phase === 'correction' ? 'to correct' : 'left'}`;
}
