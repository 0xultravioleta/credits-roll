export const WHEEL_PRIZES = [
  'Pick the next challenge',
  'Name something in the stream',
  'Choose the next topic',
  'End-of-stream shoutout',
] as const;
export function allowedPrize(value: unknown): value is (typeof WHEEL_PRIZES)[number] {
  return typeof value === 'string' && WHEEL_PRIZES.some((prize) => prize === value);
}
export function rewardPrompt(prize: string, free: boolean): string {
  if (!allowedPrize(prize)) throw new Error('Choose one of the four available prizes');
  return `${prize}. ${free ? 'Credited this stream? Your entry is refunded. ' : ''}1 winner per stream.`;
}
