import { AdReportingProvider } from '@prisma/client';

export type AdsProvider = AdReportingProvider;
export type AdsTokens = { accessToken: string; refreshToken?: string; expiresAt: number };
export type AdsAccount = {
  id: string; name: string; currency: string; timezone: string;
  status: string; loginCustomerId?: string;
};
export type AdsErrorCode = 'NOT_CONFIGURED' | 'REAUTH_REQUIRED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INVALID_RESPONSE';
export class AdsProviderError extends Error {
  constructor(public readonly code: AdsErrorCode, public readonly retryAfter = 60) {
    super(code); // Never retain raw provider responses, URLs or token values.
  }
}
export interface AdvertisingProvider {
  configured(): boolean;
  authorize(state: string, verifier: string, management?: boolean): string;
  exchange(code: string, verifier: string): Promise<AdsTokens>;
  refresh(tokens: AdsTokens): Promise<AdsTokens>;
  accounts(accessToken: string, signal?: AbortSignal): Promise<AdsAccount[]>;
  revoke(tokens: AdsTokens): Promise<void>;
}
