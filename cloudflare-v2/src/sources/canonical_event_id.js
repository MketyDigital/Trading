import { SOURCE_FAMILIES } from './provider_registry.js';

function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${label} is required`);
  }
  return String(value).trim();
}

export function buildCanonicalSourceEventId({ sourceFamily, nativeIdentity, accountScope } = {}) {
  const family = String(sourceFamily ?? '').trim();
  const scope = required(accountScope, 'Account scope');
  const identity = nativeIdentity && typeof nativeIdentity === 'object' ? nativeIdentity : {};

  switch (family) {
    case SOURCE_FAMILIES.TELEGRAM: {
      const chatId = required(identity.chatId ?? identity.chat_id, 'Telegram chat id');
      const messageId = required(identity.messageId ?? identity.message_id, 'Telegram message id');
      return `telegram:${scope}:${chatId}:${messageId}`;
    }
    case SOURCE_FAMILIES.TRADINGVIEW:
    case SOURCE_FAMILIES.MT5:
    case SOURCE_FAMILIES.CTRADER:
    case SOURCE_FAMILIES.CUSTOM_API: {
      const eventId = required(
        identity.eventId ?? identity.event_id ?? identity.transactionId ?? identity.transaction_id,
        'Native event id',
      );
      return `${family}:${scope}:${eventId}`;
    }
    default:
      throw new Error(`Unsupported source family: ${family}`);
  }
}
