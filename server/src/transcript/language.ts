export type LanguageSetting = 'auto' | 'en' | 'es';
export interface TranscriptionLanguage {
  saved: LanguageSetting;
  resolved: string;
  streamLanguage: string | null;
  source: 'setting' | 'stream' | 'environment' | 'fallback';
  warning: string | null;
}

export function languageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

export function transcriptionLanguage(
  saved: LanguageSetting,
  streamLanguage: string | null,
  fallback?: string,
  live = false,
): TranscriptionLanguage {
  const environment = languageCode(fallback);
  const resolved = saved === 'auto' ? (streamLanguage ?? environment ?? 'en') : saved;
  return {
    saved,
    resolved,
    streamLanguage,
    source:
      saved !== 'auto'
        ? 'setting'
        : streamLanguage
          ? 'stream'
          : environment
            ? 'environment'
            : 'fallback',
    warning:
      saved !== 'auto' && streamLanguage && saved !== streamLanguage
        ? `Saved transcription language (${saved}) differs from the live stream language (${streamLanguage}). Choose Auto or the language you speak to match chat.`
        : saved === 'auto' && live && !streamLanguage
          ? `Auto is using a fallback language (${resolved}) while live. Twitch stream language is not available yet; it is checked again every minute.`
          : null,
  };
}

export async function resolveStreamLanguage(
  probe: () => Promise<{ language: string | null } | null>,
): Promise<string | null> {
  try {
    return languageCode((await probe())?.language);
  } catch {
    return null;
  }
}
