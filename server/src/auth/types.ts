export type AccountRole = 'streamer' | 'bot';
export const SCOPES: Record<AccountRole, readonly string[]> = {
  streamer: ['channel:bot', 'channel:manage:redemptions', 'channel:read:redemptions'],
  bot: ['user:read:chat', 'user:write:chat', 'user:bot'],
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
