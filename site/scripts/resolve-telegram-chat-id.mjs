const token = String(process.env.TELEGRAM_LEADS_BOT_TOKEN || '').trim();
const recipientUsername = String(process.env.TELEGRAM_LEADS_RECIPIENT_USERNAME || 'Temka231')
  .trim()
  .replace(/^@/, '')
  .toLowerCase();

if (!token) throw new Error('Set TELEGRAM_LEADS_BOT_TOKEN in .env before resolving the chat ID.');
if (!recipientUsername) throw new Error('Set TELEGRAM_LEADS_RECIPIENT_USERNAME to the recipient username.');

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
  headers: { Accept:'application/json' },
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
