/** How long a webhook may take to answer. */
export const WEBHOOK_TIMEOUT_MS = 15000;

/**
 * Posts a notification to a webhook: the JSON payload for format "json", or
 * the short text for format "text", which push services such as ntfy show as
 * is. A secret, when set, goes in an Authorization: Bearer header.
 */
export async function postWebhook({ url, format, secret = null, message, fetchImpl = fetch }) {
  const headers = { 'Content-Type': format === 'text' ? 'text/plain; charset=utf-8' : 'application/json', 'User-Agent': 'auto-check' };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  if (format === 'text') headers.Title = message.subject;
  const body = format === 'text' ? message.short : JSON.stringify(message.payload);
  const response = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`the webhook answered ${response.status} ${response.statusText}`.trim());
  return { status: response.status };
}
