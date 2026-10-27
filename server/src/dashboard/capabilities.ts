import { CORE_SCOPES, STREAMER_FEATURES } from '../auth/types.js';
import type { OAuthAccounts } from '../auth/oauth.js';

export type BroadcasterType = '' | 'affiliate' | 'partner';
export function channelCapabilities(accounts?: OAuthAccounts, type: BroadcasterType | null = null) {
  const granted = accounts?.scopes('streamer') ?? [];
  const affiliate = type === 'affiliate' || type === 'partner';
  return {
    broadcasterType: type,
    channelType:
      type === null ? 'Not checked yet' : type || 'Regular channel (not Affiliate or Partner)',
    affiliate,
    wheelAvailable: affiliate && CORE_SCOPES.streamer.every((scope) => granted.includes(scope)),
    eligibilityReason:
      type === null
        ? 'Channel type has not been verified. Connect both accounts and enable live mode to check.'
        : affiliate
          ? 'Affiliate or Partner channel verified.'
          : 'Channel Points, predictions and polls require an Affiliate or Partner channel. Recognition, credits and practice still work.',
    features: STREAMER_FEATURES.map((row) => ({
      ...row,
      granted: granted.includes(row.scope),
      visible: !row.affiliateOnly || affiliate,
      implemented: false,
      message: granted.includes(row.scope)
        ? `Permission ready for ${row.feature}; the feature will be added in a later update.`
        : `Reconnect streamer to enable ${row.feature}`,
    })),
    coreScopes: (['streamer', 'bot'] as const).flatMap((role) =>
      CORE_SCOPES[role].map((scope) => ({
        role,
        scope,
        granted: accounts?.scopes(role).includes(scope) ?? false,
      })),
    ),
  };
}
