import type { ChatMessage, TranscriptWindow } from '../domain.js';
import type { Judge, Judgment } from './judge.js';
import { isInstructionAttack, words } from './judge.js';
import { messageOrder, MATCH_RULES } from './rules.js';

// Deliberately conservative heuristic for offline development, not a causal proof.
export class FakeJudge implements Judge {
  async judge(window: TranscriptWindow, messages: ChatMessage[]): Promise<Judgment[]> {
    if (
      /\b(?:won['’]t|will not|not going to|ignore that|bad idea|no thanks|do not|don['’]t|no voy a|mala idea|no gracias)\b/i.test(
        window.text,
      )
    )
      return [];
    if (
      !/(?:let['’]s|i['’]ll|i will|i['’]m going to|switching to|you['’]re right|good (?:idea|call)|thanks|chat suggested|that works|you fixed|calling it|i['’]m using|buena idea|como dijo|vamos con lo de)/i.test(
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
      const kind =
        /\b(?:fix|press|click|mute|audio|settings|lower|heal|equip|baja|pulsa|silencia)\b/i.test(
          message.text,
        )
          ? 'assist'
          : /\b(?:name|call|joke|pun|llama|nombre|broma)\b/i.test(message.text)
            ? 'riff'
            : 'idea';
      return [
        {
          messageId: message.id,
          kind: messageOrder(window, message).ordering === 'streamer spoke first' ? 'riff' : kind,
          confidence:
            messageOrder(window, message).ordering === 'streamer spoke first'
              ? MATCH_RULES.tailConfidenceCap
              : Number((0.75 + (0.2 * overlap) / tokens.length).toFixed(2)),
        },
      ];
    });
  }
}
