import type { ChatMessage, TranscriptWindow } from '../domain.js';
import type { Judge, Judgment } from './judge.js';
import { isInstructionAttack, words } from './judge.js';

// Deliberately conservative heuristic for offline development, not a causal proof.
export class FakeJudge implements Judge {
  async judge(window: TranscriptWindow, messages: ChatMessage[]): Promise<Judgment[]> {
    if (
      /\b(?:won['’]t|will not|not going to|ignore that|bad idea|no thanks|do not|don['’]t)\b/i.test(
        window.text,
      )
    )
      return [];
    if (
      !/(?:let['’]s|i['’]ll|i will|i['’]m going to|switching to|you['’]re right|good (?:idea|call)|thanks|chat suggested|that works|you fixed|calling it|i['’]m using)/i.test(
        window.text,
      )
    )
      return [];
    const transcript = new Set(words(window.text));
    return messages.flatMap((message) => {
      if (isInstructionAttack(message.text)) return [];
      const tokens = words(message.text);
      const overlap = tokens.filter((word) => transcript.has(word)).length;
      if (overlap < 2 || overlap / tokens.length < 0.6) return [];
      const kind = /\b(?:fix|press|click|mute|audio|settings|lower|heal|equip)\b/i.test(
        message.text,
      )
        ? 'assist'
        : /\b(?:name|call|joke|pun)\b/i.test(message.text)
          ? 'riff'
          : 'idea';
      return [
        {
          messageId: message.id,
          kind,
          confidence: Number((0.75 + (0.2 * overlap) / tokens.length).toFixed(2)),
        },
      ];
    });
  }
}
