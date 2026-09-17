BEGIN;

ALTER TABLE public.ai_providers
  ADD COLUMN IF NOT EXISTS provider_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- New provider writes persist credentials only in encrypted ciphertext. Keep the
-- legacy plaintext column readable during migration, but do not require it for
-- new rows.
ALTER TABLE public.ai_providers
  ALTER COLUMN api_key DROP NOT NULL;

ALTER TABLE public.ai_providers
  DROP CONSTRAINT IF EXISTS ai_providers_provider_name_check;

ALTER TABLE public.ai_providers
  ADD CONSTRAINT ai_providers_provider_name_check
  CHECK (provider_name IN (
    'openai',
    'azure_openai',
    'gemini',
    'google',
    'vertex_ai',
    'cloudflare_ai',
    'workers_ai',
    'aws_bedrock',
    'deepseek',
    'groq',
    'custom'
  ));

COMMIT;
