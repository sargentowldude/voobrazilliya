const token = String(process.env.TELEGRAM_LEADS_BOT_TOKEN || '').trim();
const recipientUsername = String(process.env.TELEGRAM_LEADS_RECIPIENT_USERNAME || 'Temka231')
  .trim()
  .replace(/^@/, '')
  .toLowerCase();
const apiBaseUrlValue = String(process.env.TELEGRAM_LEADS_API_BASE_URL || 'https://api.telegram.org').trim();
let apiBaseUrl = '';
try {
  const url = new URL(apiBaseUrlValue);
  if (url.protocol === 'https:') apiBaseUrl = url.toString().replace(/\/$/, '');
} catch {
  // The error below intentionally does not repeat the configured address or the token.
}

if (!token) throw new Error('Set TELEGRAM_LEADS_BOT_TOKEN in .env before resolving the chat ID.');
if (!recipientUsername) throw new Error('Set TELEGRAM_LEADS_RECIPIENT_USERNAME to the recipient username.');
if (!apiBaseUrl) throw new Error('Set TELEGRAM_LEADS_API_BASE_URL to a valid HTTPS endpoint.');

const response = await fetch(`${apiBaseUrl}/bot${token}/getUpdates`, {
  method:'POST',
  headers: { 'Content-Type':'application/json', Accept:'application/json' },
  body: JSON.stringify({ allowed_updates:['message', 'edited_message'] }),
  signal: AbortSignal.timeout(7_000)
});
if (!response.ok) throw new Error(`Telegram getUpdates failed with HTTP ${response.status}.`);

const payload = await response.json();
const updates = Array.isArray(payload?.result) ? payload.result : [];
const matchingMessages = updates
  .map(update => update?.message || update?.edited_message)
  .filter(message => message?.chat?.type === 'private'
    && String(message?.from?.username || '').toLowerCase() === recipientUsername
    && Number.isFinite(Number(message?.chat?.id)));
const recipientMessage = matchingMessages.at(-1);

if (!recipientMessage) {
  throw new Error(`No private /start message from @${recipientUsername} was found. Open the bot and send /start, then run this command again.`);
}

console.log(`TELEGRAM_LEADS_CHAT_ID=${recipientMessage.chat.id}`);
