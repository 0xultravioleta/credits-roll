import type { CreditSummary } from '../../server/src/events/protocol.js';

export function layoutCredits(entries: CreditSummary[], wrap: (quote: string) => string[]) {
  let cursor = 450;
  const rows = [...entries]
    .sort((a, b) => b.points - a.points || a.viewer.id.localeCompare(b.viewer.id))
    .map((entry) => {
      const quoteLines = (entry.quotes ?? []).flatMap((quote) => wrap(`“${quote.text}”`));
      const row = { entry, y: cursor, quoteLines };
      cursor += 170 + quoteLines.length * 32;
      return row;
    });
  return { rows, end: cursor + 120, contentHeight: cursor + 430 };
}
