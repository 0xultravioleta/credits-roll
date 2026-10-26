export const ADOPTION_EXCERPT_MAX_LENGTH = 200;

export function shortExcerpt(text: string): string {
  return Array.from(text.replace(/\s+/gu, ' ').trim())
    .slice(0, ADOPTION_EXCERPT_MAX_LENGTH)
    .join('');
}

// Use canonical transcript text, never provider-invented text. Prefer the sentence
// with the most suggestion words; break ties toward the streamer's later response.
export function adoptionExcerpt(transcript: string, quote: string): string {
  const tokens = (value: string) => value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const suggestion = new Set(tokens(quote));
  const sentences =
    transcript
      .replace(/\s+/gu, ' ')
      .trim()
      .match(/[^.!?]+[.!?]*/gu) ?? [];
  let selected = '';
  let best = -1;
  for (const sentence of sentences) {
    const overlap = new Set(tokens(sentence).filter((word) => suggestion.has(word))).size;
    if (overlap >= best) {
      selected = sentence;
      best = overlap;
    }
  }
  return shortExcerpt(selected);
}
