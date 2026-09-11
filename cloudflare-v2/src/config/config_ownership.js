export const PLATFORM_BOOTSTRAP_KEYS = Object.freeze(new Set([
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'TRADING_MASTER_KEY',
  'MKETY_TRADING_ADMIN_SECRET',
  'TRADING_ACCESS_CODE_SESSION_SECRET',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CBOT_TOKEN_SIGNING_KEY',
  'CBOT_CONTROL_SECRET',
  'CTRADER_CLIENT_ID',
  'CTRADER_CLIENT_SECRET',
  'CTRADER_REDIRECT_URI',
  'CTRADER_CBOT_GATEWAY_URL',
  'CTRADER_CBOT_WS_URL',
  'MTPROTO_INTERNAL_SOURCE_URL',
]));

export const DATABASE_AUTHORITATIVE_CONFIGURATION = Object.freeze([
  'workspace/customer settings and entitlements',
  'source selection, source health/policy and Telegram chat IDs',
  'customer broker account IDs, broker/server and demo/live environment',
  'connection provider state and encrypted customer credentials',
  'account roles and execution/safety/risk/lot policies',
  'broker symbol catalogs, symbol aliases and catalog refresh state',
  'destinations and source-to-destination routes',
  'formatting templates and customer presentation settings',
  'workspace AI provider/model settings and encrypted customer provider credentials',
  'connector pairing, revocation and reconnect state',
]);

const CUSTOMER_ENV_KEY_PATTERNS = [
  /^(?:MT5|CTRADER)_(?:ACCOUNT|LOGIN|SERVER|PASSWORD|BROKER|SYMBOL|LOT|RISK|BRIDGE_URL|BRIDGE_SECRET)(?:_|$)/i,
  /^(?:TRADING_)?SOURCE_(?:ID|CHAT|ALLOWED_CHAT|ROUTE)(?:_|$)/i,
  /^ALLOWED_CHAT_IDS$/i,
  /^TELEGRAM_ACCOUNT_SCOPE$/i,
];

export function isPlatformBootstrapKey(name) {
  return PLATFORM_BOOTSTRAP_KEYS.has(String(name ?? '').trim());
}

export function isCustomerSpecificEnvironmentKey(name) {
  const key = String(name ?? '').trim();
  if (!key || isPlatformBootstrapKey(key)) return false;
  return CUSTOMER_ENV_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function assertNoCustomerSpecificRequiredEnvironment(requiredKeys = []) {
  const invalid = [...requiredKeys].map(String).filter(isCustomerSpecificEnvironmentKey);
  if (invalid.length) {
    const error = new Error(`Customer-specific configuration must be database-authoritative: ${invalid.join(', ')}`);
    error.code = 'CUSTOMER_CONFIGURATION_MUST_USE_DATABASE';
    error.invalidKeys = invalid;
    throw error;
  }
  return true;
}
