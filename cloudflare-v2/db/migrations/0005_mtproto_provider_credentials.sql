BEGIN;

-- Provider runtime credentials are a different trust domain from the signed V1
-- ingress HMAC stored in secret_ciphertext. Keep them in a separate encrypted
-- envelope so Telegram sessions/API credentials can never be confused with
-- event-authentication secrets or placed in plaintext JSON config.
ALTER TABLE public.source_connections
    ADD COLUMN IF NOT EXISTS provider_secret_ciphertext TEXT;

COMMENT ON COLUMN public.source_connections.provider_secret_ciphertext IS
    'Provider-specific encrypted credential envelope; decrypt server-side only and never expose through client/admin status responses.';

COMMIT;
