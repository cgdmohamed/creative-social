import { AdsProviderError } from '../advertising.types';
// Do not pass unexpected nested provider objects into browser DTOs/review JSON.
export function campaignText(value: unknown, fallback: string | null, length = 500): string | null {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > length) throw new AdsProviderError('INVALID_RESPONSE');
  return value;
}
export function campaignBudget(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new AdsProviderError('INVALID_RESPONSE');
  return value;
}
