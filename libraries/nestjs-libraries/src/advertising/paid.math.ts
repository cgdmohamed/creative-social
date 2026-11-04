import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PaidQuery, paidLevels } from './paid.types';
const day = 86400000;
export const attributionFingerprint = (details: unknown) => createHash('sha256').update(JSON.stringify(details || {})).digest('hex');
export const dateText = (value: Date) => value.toISOString().slice(0, 10);
export function dateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Dates must use YYYY-MM-DD');
  const result = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(result.getTime()) || dateText(result) !== value) throw new BadRequestException('Invalid reporting date');
  return result;
}
export function validatePaidQuery(query: PaidQuery): PaidQuery {
  const from = dateOnly(query.from), to = dateOnly(query.to);
  if (to < from || (to.getTime() - from.getTime()) / day >= 93 || !paidLevels.includes(query.level)) throw new BadRequestException('Choose one reporting level and a range of 1–93 days');
  if (query.provider && !['META_ADS', 'GOOGLE_ADS'].includes(query.provider)) throw new BadRequestException('Unsupported paid provider');
  if (query.campaignId && query.level === 'ACCOUNT') throw new BadRequestException('Campaign filters require campaign, ad group or ad reporting level');
  for (const field of ['customerId', 'accountId', 'campaignId'] as const)
    if (query[field] !== undefined && (typeof query[field] !== 'string' || !query[field] || query[field]!.length > 100)) throw new BadRequestException('Invalid reporting filter');
  return query;
}
export function previousPeriod(query: PaidQuery) {
  const from = dateOnly(query.from), to = dateOnly(query.to);
  const days = Math.round((to.getTime() - from.getTime()) / day) + 1;
  return { from: dateText(new Date(from.getTime() - days * day)), to: dateText(new Date(from.getTime() - day)) };
}
export function accountYesterday(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return dateText(new Date(dateOnly(`${get('year')}-${get('month')}-${get('day')}`).getTime() - day));
}
export function decimal(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(String(value))) throw new Error('INVALID_METRIC');
  const number = new Prisma.Decimal(String(value));
  if (!number.isFinite() || number.abs().greaterThan('99999999999999')) throw new Error('INVALID_METRIC');
  return number.toFixed();
}
export function integer(value: unknown): string | null {
  const result = decimal(value);
  if (result !== null && !/^\d+$/.test(result)) throw new Error('INVALID_COUNTER');
  return result;
}
export function sum(rows: any[], key: string): string | null {
  if (!rows.length || rows.some((row) => row[key] === null || row[key] === undefined)) return null;
  return rows.reduce((total, row) => total.plus(String(row[key])), new Prisma.Decimal(0)).toFixed();
}
export function ratio(numerator: string | null, denominator: string | null, scale = 1) {
  return numerator === null || denominator === null || new Prisma.Decimal(denominator).lessThanOrEqualTo(0)
    ? null : new Prisma.Decimal(numerator).div(denominator).mul(scale).toDecimalPlaces(6).toFixed();
}
export function metrics(rows: any[], reach: string | null = null) {
  const spend = sum(rows, 'spend'), impressions = sum(rows, 'impressions'), clicks = sum(rows, 'clicks');
  const conversions = sum(rows, 'conversions'), leads = sum(rows, 'leads'), purchaseValue = sum(rows, 'purchaseConversionValue');
  return { spend, impressions, reach, clicks, ctr: ratio(clicks, impressions, 100), cpc: ratio(spend, clicks), cpm: ratio(spend, impressions, 1000),
    conversions, conversionRate: ratio(conversions, clicks, 100), cpa: ratio(spend, conversions), leads, cpl: ratio(spend, leads),
    purchaseValue, roas: rows.length && rows.every((r) => r.valueTrackingVerified) ? ratio(purchaseValue, spend) : null };
}
export function compare(current: string | null, previous: string | null) {
  if (current === null || previous === null) return { delta: null, percent: null };
  return { delta: new Prisma.Decimal(current).minus(previous).toFixed(), percent: ratio(new Prisma.Decimal(current).minus(previous).toFixed(), previous, 100) };
}
export function covered(jobs: { fromDate: Date; toDate: Date }[], from: string, to: string) {
  for (let time = dateOnly(from).getTime(); time <= dateOnly(to).getTime(); time += day)
    if (!jobs.some((job) => job.fromDate.getTime() <= time && job.toDate.getTime() >= time)) return false;
  return true;
}
