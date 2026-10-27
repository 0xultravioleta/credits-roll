import type { CreditSummary } from '../../server/src/events/protocol.js';

export function layoutCredits(
  entries: CreditSummary[],
  wrap: (quote: string, clipped?: boolean) => string[],
) {
  let cursor = 450;
  const rows = [...entries]
    .sort((a, b) => b.points - a.points || a.viewer.id.localeCompare(b.viewer.id))
    .map((entry) => {
      let offset = 140;
      const quoteRows = (entry.quotes ?? []).map((quote) => {
        const lines = wrap(`“${quote.text}”`, !!quote.clip);
        const row = { quote, lines, y: offset };
        offset += Math.max(lines.length * 32, quote.clip ? 154 : 0);
        return row;
      });
      const quoteLines = quoteRows.flatMap((row) => row.lines);
      const row = { entry, y: cursor, quoteLines, quoteRows };
      cursor += 170 + offset - 140;
      return row;
    });
  return { rows, end: cursor + 120, contentHeight: cursor + 430 };
}
