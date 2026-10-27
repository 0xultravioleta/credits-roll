export type AccountRole = 'streamer' | 'bot';
export const CORE_SCOPES: Record<AccountRole, readonly string[]> = {
  streamer: ['channel:bot', 'channel:manage:redemptions', 'channel:read:redemptions'],
  bot: ['user:read:chat', 'user:write:chat', 'user:bot'],
};
export const STREAMER_FEATURES = [
  { scope: 'clips:edit', feature: 'clips', affiliateOnly: false },
  { scope: 'channel:manage:broadcast', feature: 'stream markers', affiliateOnly: false },
  { scope: 'channel:manage:predictions', feature: 'predictions', affiliateOnly: true },
  { scope: 'channel:manage:polls', feature: 'polls', affiliateOnly: true },
] as const;
export const SCOPES: Record<AccountRole, readonly string[]> = {
  ...CORE_SCOPES,
  streamer: [...CORE_SCOPES.streamer, ...STREAMER_FEATURES.map((row) => row.scope)],
};
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
export interface TokenGrant {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}
export interface TokenIdentity {
  clientId: string;
  userId: string;
  login: string;
  scopes: string[];
  expiresIn: number;
}
export interface AccountToken extends TokenGrant {
  userId: string;
  login: string;
  expiresAt: number;
}
export type Accounts = Partial<Record<AccountRole, AccountToken>>;
export interface TokenStorage {
  read(): Accounts;
  write(accounts: Accounts): void;
}
export interface OAuthTransport {
  exchange(code: string): Promise<TokenGrant>;
  refresh(refreshToken: string): Promise<TokenGrant>;
  validate(accessToken: string): Promise<TokenIdentity>;
}
