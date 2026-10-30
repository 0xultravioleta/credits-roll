import type { ChatMessage, MomentKind, TranscriptWindow } from '../domain.js';

export interface Judgment {
  messageId: string;
  kind: MomentKind;
  confidence: number;
}

export interface Judge {
  judge(
    window: TranscriptWindow,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<Judgment[]>;
}

const STOP = new Set(
  'a an and are as at be but by can could do for from good hey i if in is it its lets me my of on or please that the this to try use we with you your thanks idea call will ll buena como dijo vamos con del los las una por para que'.split(
    ' ',
  ),
);
export function words(input: string): string[] {
  return [
    ...new Set(
      input
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/['’]/g, '')
        .match(/[a-z0-9]+/g) ?? [],
    ),
  ].filter((word) => word.length > 2 && !STOP.has(word));
}

export function isInstructionAttack(text: string): boolean {
  return /ignore (?:all|previous)|system prompt|return.{0,30}json|give me credit|assign.{0,20}confidence/i.test(
    text,
  );
}
