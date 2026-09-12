-- Secure AI provider credentials are written to api_key_ciphertext.
-- The legacy plaintext api_key column must not be required for new rows.
ALTER TABLE public.ai_providers
  ALTER COLUMN api_key DROP NOT NULL;
