-- Additive presentation-only formatting mode for Telegram destinations.
-- Existing modes and rows remain unchanged.
ALTER TABLE public.trading_destination_templates
  DROP CONSTRAINT IF EXISTS trading_destination_templates_formatting_mode_check;

ALTER TABLE public.trading_destination_templates
  ADD CONSTRAINT trading_destination_templates_formatting_mode_check
  CHECK (formatting_mode IN ('none', 'clean', 'template', 'ai_then_fallback', 'clean_ai_fallback'));
