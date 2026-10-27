import type { MemoryCreditLedger } from '../ledger/index.js';
import type { Store } from '../store/index.js';

const KEY = 'clips:forgotten-count';
export function forgottenClipCount(store: Store): number {
  const value = Number(store.getSetting(KEY) ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export function forgetCreditMedia(
  store: Store,
  ledger: MemoryCreditLedger,
  viewerId: string,
): void {
  const named = ledger
    .read()
    .filter(
      (row) => row.viewerId === viewerId && row.media?.clip.named && !row.media.clip.demo,
    ).length;
  // Keep only an anonymous aggregate. A dispatched but unconfirmed request may already
  // exist on Twitch, so count it conservatively. Repeated commands find no retained rows.
  store.transaction(() => {
    if (named) store.setSetting(KEY, String(forgottenClipCount(store) + named));
    ledger.forgetViewer(viewerId);
  });
}
