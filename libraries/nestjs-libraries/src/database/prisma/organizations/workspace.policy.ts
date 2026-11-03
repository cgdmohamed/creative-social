import { BadRequestException, ForbiddenException } from '@nestjs/common';

export function workspaceName(value: unknown): string {
  if (typeof value !== 'string') throw new BadRequestException('Invalid workspace name');
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f<>]/u.test(name)) {
    throw new BadRequestException('Workspace name must be 1–80 characters without control characters or angle brackets');
  }
  return name;
}

export function workspaceLimit(): number {
  const value = process.env.MAX_WORKSPACES_PER_USER ?? '10';
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ForbiddenException('Workspace creation quota is not configured correctly');
  }
  return Number(value);
}

export function assertWorkspaceManager(org: {
  users?: { role: string; disabled?: boolean }[];
}) {
  const member = org.users?.[0];
  if (!member || member.disabled || !['ADMIN', 'SUPERADMIN'].includes(member.role)) {
    throw new ForbiddenException('Workspace administrator access required');
  }
}

// Cookie-authenticated writes must originate from the configured frontend.
// Non-browser API clients may instead supply the existing explicit auth header.
export function assertWorkspaceOrigin(headers: { origin?: string; auth?: unknown }) {
  if (!headers.origin && typeof headers.auth === 'string' && headers.auth) return;
  let expected: string;
  try { expected = new URL(process.env.FRONTEND_URL!).origin; }
  catch { throw new ForbiddenException('Workspace origin is not configured'); }
  if (!headers.origin || headers.origin !== expected) {
    throw new ForbiddenException('Workspace request origin denied');
  }
}
