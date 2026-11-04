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
export function campaignMetadata(value: unknown): any {
  if (value === undefined || value === null) return null;
  const visit = (item: any, depth: number): any => {
    if (depth > 8) throw new AdsProviderError('INVALID_RESPONSE');
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') { if (item.length > 4096) throw new AdsProviderError('INVALID_RESPONSE'); return item; }
    if (Array.isArray(item)) { if (item.length > 200) throw new AdsProviderError('INVALID_RESPONSE'); return item.map((entry) => visit(entry, depth + 1)); }
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([key]) => !/access.?token|refresh.?token|secret|password|appsecret|credential|__proto__|constructor|prototype/i.test(key)).map(([key, entry]) => [key, visit(entry, depth + 1)]));
    throw new AdsProviderError('INVALID_RESPONSE');
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw new AdsProviderError('INVALID_RESPONSE');
  return result;
}
