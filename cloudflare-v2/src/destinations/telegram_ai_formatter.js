const DESTINATION_FORMAT_PROMPT = `Return JSON only with this exact shape: {"text":"formatted Telegram message","canonicalEcho":{"side":...,"symbol":...,"entry":...,"stopLoss":...,"takeProfits":[...]}}. You are formatting presentation only. Preserve every canonical trading value exactly. Do not invent or remove symbol, side, entry, stop loss or take profits. You may improve spacing, labels, emoji, header/footer and branding. If the input is a management/follow-up message, preserve the deterministic management instruction exactly in meaning.`;

function cleanJson(text) {
  const value = String(text ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  return JSON.parse(value);
}

function bounded(value, fallback = 450) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(100, Math.min(1500, number));
}

export function createTelegramDestinationAiFormatter(aiRouter) {
  if (!aiRouter?.processSignal) return null;

  return async ({ deterministicText, brandName, presentation = {}, canonical } = {}) => {
    const timeoutMs = bounded(presentation.aiTimeoutMs ?? presentation.ai_timeout_ms);
    const payload = JSON.stringify({
      deterministicText: String(deterministicText ?? ''),
      brandName: brandName ?? null,
      presentationInstructions: String(presentation.aiInstructions ?? presentation.ai_instructions ?? '').trim() || null,
      style: {
        header: presentation.header ?? null,
        suffix: presentation.suffix ?? null,
        labels: presentation.labels ?? null,
        emojiStyle: presentation.emojiStyle ?? presentation.emoji_style ?? null,
      },
      canonical,
    });

    const ai = await aiRouter.processSignal(payload, DESTINATION_FORMAT_PROMPT, {
      timeoutMs,
      purpose: 'destination_ai',
    });
    if (!ai?.success || !ai.text) return { success: false, error: ai?.error || 'AI_FORMAT_FAILED' };

    try {
      const parsed = cleanJson(ai.text);
      return {
        success: typeof parsed?.text === 'string' && parsed.text.trim().length > 0,
        text: typeof parsed?.text === 'string' ? parsed.text : '',
        canonicalEcho: parsed?.canonicalEcho,
        provider: ai.provider ?? null,
        model: ai.model ?? null,
      };
    } catch {
      return { success: false, error: 'AI_FORMAT_INVALID_JSON' };
    }
  };
}
