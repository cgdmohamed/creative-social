export type MutationIssue = { code: string; field?: string; message?: string };
export class CampaignMutationError extends Error {
  constructor(public outcome: 'REJECTED' | 'UNKNOWN', public code: string, public issues: MutationIssue[] = [], public retryAfter = 0, public requestId?: string) { super(code); }
}
const identifier = (value: unknown) => typeof value === 'string' && /^[\w:.-]{1,150}$/.test(value) ? value : undefined;
// Dedicated mutation boundary: a network/5xx/malformed response is NOT evidence
// that a create failed. No retries occur here. Never retain raw error messages.
export async function campaignMutation(url: string, options: RequestInit): Promise<{ body: any; requestId?: string }> {
  let response: Response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) }); }
  catch { throw new CampaignMutationError('UNKNOWN', 'TRANSPORT_OUTCOME_UNKNOWN'); }
  const requestId = identifier(response.headers.get('request-id') || response.headers.get('x-fb-trace-id'));
  let body: any;
  try {
    const text = await response.text();
    if (Buffer.byteLength(text) > 5 * 1024 * 1024) throw new Error();
    body = JSON.parse(text);
  } catch { throw new CampaignMutationError('UNKNOWN', 'INVALID_PROVIDER_RESPONSE', [], 0, requestId); }
  if (!response.ok || body?.error || body?.partialFailureError) {
    const error = body?.error || body?.partialFailureError;
    const issues: MutationIssue[] = [];
    for (const detail of Array.isArray(error?.details) ? error.details.slice(0, 20) : []) {
      for (const item of Array.isArray(detail.errors) ? detail.errors.slice(0, 20) : []) {
        const code = identifier(Object.values(item.errorCode || {})[0]) || 'PROVIDER_VALIDATION';
        const elements = item.location?.fieldPathElements;
        const field = Array.isArray(elements) ? elements.slice(0, 10).map((entry: any) => identifier(entry.fieldName) || 'field').join('.') : undefined;
        issues.push({ code, ...(field ? { field } : {}) });
      }
    }
    if (error?.code !== undefined) issues.push({ code: identifier(String(error.code)) || 'PROVIDER_ERROR' });
    if (typeof error?.error_user_msg === 'string') {
      const headers = new Headers(options.headers), token = headers.get('Authorization')?.replace(/^Bearer /, '');
      const proof = options.body instanceof URLSearchParams ? options.body.get('appsecret_proof') : options.body instanceof FormData ? options.body.get('appsecret_proof') : null;
      let message = error.error_user_msg.slice(0, 1000);
      for (const secret of [token, proof]) if (typeof secret === 'string' && secret) message = message.split(secret).join('[redacted]');
      message = message.replace(/(?:access_token|appsecret_proof|client_secret)\s*[=:]\s*[^\s&]+/gi, 'credential=[redacted]');
      issues.push({ code: identifier(String(error.error_subcode || error.code || 'PROVIDER_VALIDATION')) || 'PROVIDER_VALIDATION', message });
    }
    const retryHeader = response.headers.get('retry-after');
    const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Math.min(3600, Number(retryHeader)) : 60;
    const googleAuthentication = Array.isArray(error?.details) && error.details.some((detail: any) => Array.isArray(detail.errors) && detail.errors.some((item: any) => item.errorCode?.authenticationError));
    const code = response.status === 429 || [4, 17, 32, 613].includes(Number(error?.code)) || error?.status === 'RESOURCE_EXHAUSTED' ? 'RATE_LIMITED' : response.status === 401 || [10, 190, 200, 294].includes(Number(error?.code)) || googleAuthentication ? 'REAUTH_REQUIRED' : 'PROVIDER_VALIDATION';
    throw new CampaignMutationError(response.status >= 400 && response.status < 500 && error ? 'REJECTED' : 'UNKNOWN', code, issues.slice(0, 30), retryAfter, requestId);
  }
  if (!body || typeof body !== 'object') throw new CampaignMutationError('UNKNOWN', 'INVALID_PROVIDER_RESPONSE', [], 0, requestId);
  return { body, requestId };
}
