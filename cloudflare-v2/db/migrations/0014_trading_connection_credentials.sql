BEGIN;

ALTER TABLE public.trade_accounts
    ADD COLUMN IF NOT EXISTS credential_ciphertext TEXT;

COMMENT ON COLUMN public.trade_accounts.credential_ciphertext IS
    'Broker/provider credential encrypted envelope; decrypt server-side only and never expose through client/admin responses.';

COMMIT;
