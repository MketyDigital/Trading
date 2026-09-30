BEGIN;

ALTER TABLE public.ai_providers
  DROP CONSTRAINT IF EXISTS ai_providers_provider_name_check;

ALTER TABLE public.ai_providers
  ADD CONSTRAINT ai_providers_provider_name_check
  CHECK (provider_name IN (
    'openai',
    'azure_openai',
    'mkety_ai',
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
