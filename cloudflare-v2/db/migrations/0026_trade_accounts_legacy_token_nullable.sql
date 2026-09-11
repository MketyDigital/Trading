-- Unified provider modes store encrypted credentials in credential_ciphertext.
-- Keep existing legacy token values, but do not require the legacy column for new rows.
alter table public.trade_accounts
  alter column api_token_encrypted drop not null;
