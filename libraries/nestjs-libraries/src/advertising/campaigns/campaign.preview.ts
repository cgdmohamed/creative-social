export function creativePreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !/(^|\.)(fbcdn\.net|fbsbx\.com|facebook\.com|googleusercontent\.com|gstatic\.com)$/i.test(url.hostname)) return null;
    if (Array.from(url.searchParams.keys()).some((key) => /access.?token|appsecret|client.?secret/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}
