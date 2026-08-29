/**
 * UNIVERSAL MULTI-AI CASCADE ENGINE FOR CLOUDFLARE WORKERS
 * Supports Google Gemini, OpenAI, DeepSeek, Groq, Cloudflare Workers AI, and Vertex AI
 * Features 12s fail-fast timeout, automatic failover cascade, and tag sanitization
 */

export class UniversalAIRouter {
    constructor(providers = []) {
        // Sort providers by priority (ascending: 1, 2, 3...)
        this.providers = Array.isArray(providers) 
            ? [...providers].sort((a, b) => (a.priority || 1) - (b.priority || 1))
            : [];
    }

    /**
     * Attempts to transform the raw text using the configured AI providers in cascade order.
     */
    async processSignal(rawText, systemPrompt) {
        if (!this.providers || this.providers.length === 0) {
            return { success: false, error: "No AI providers configured in database." };
        }

        let lastError = null;

        for (const provider of this.providers) {
            if (!provider.is_active || !provider.api_key_encrypted) continue;

            try {
                const result = await this.callProviderWithTimeout(provider, rawText, systemPrompt, 12000);
                if (result && result.success && result.text) {
                    const cleaned = this.cleanOutput(result.text);
                    return {
                        success: true,
                        text: cleaned,
                        provider: provider.provider_name,
                        model: provider.model_name
                    };
                }
            } catch (err) {
                console.warn(`Provider ${provider.provider_name} failed: ${err.message}. Cascading to next...`);
                lastError = err.message;
            }
        }

        return { success: false, error: lastError || "All AI providers failed in cascade." };
    }

    /**
     * Executes API call with 12s strict fail-fast timeout
     */
    async callProviderWithTimeout(provider, rawText, systemPrompt, timeoutMs = 12000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await this.executeProviderCall(provider, rawText, systemPrompt, controller.signal);
            clearTimeout(timeoutId);
            return response;
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                throw new Error(`Timeout after ${timeoutMs}ms`);
            }
            throw err;
        }
    }

    /**
     * Dispatches request to the appropriate API adapter
     */
    async executeProviderCall(provider, rawText, systemPrompt, signal) {
        const pType = (provider.provider_name || "").toLowerCase();

        if (pType.includes('gemini') || pType.includes('google')) {
            return await this.callGemini(provider, rawText, systemPrompt, signal);
        } else if (pType.includes('openai') || pType.includes('deepseek') || pType.includes('groq')) {
            return await this.callOpenAICompatible(provider, rawText, systemPrompt, signal);
        } else if (pType.includes('cloudflare') || pType.includes('workers_ai')) {
            return await this.callCloudflareAI(provider, rawText, systemPrompt, signal);
        } else {
            // Default to standard OpenAI-compatible completions format
            return await this.callOpenAICompatible(provider, rawText, systemPrompt, signal);
        }
    }

    /**
     * Google Gemini API Adapter
     */
    async callGemini(provider, rawText, systemPrompt, signal) {
        const model = provider.model_name || "gemini-2.5-flash";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${provider.api_key_encrypted}`;

        const payload = {
            contents: [
                {
                    parts: [
                        { text: `${systemPrompt}\n\nInput Signal:\n${rawText}` }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1000
            }
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini API HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return { success: !!text, text };
    }

    /**
     * OpenAI / DeepSeek / Groq Compatible Chat Completions Adapter
     */
    async callOpenAICompatible(provider, rawText, systemPrompt, signal) {
        let baseUrl = provider.base_url || "https://api.openai.com/v1";
        if (!baseUrl.endsWith('/chat/completions')) {
            baseUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
        }

        const model = provider.model_name || (provider.provider_name.includes('deepseek') ? 'deepseek-chat' : 'gpt-4o-mini');

        const payload = {
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: rawText }
            ],
            temperature: 0.1,
            max_tokens: 1000
        };

        const res = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.api_key_encrypted}`
            },
            body: JSON.stringify(payload),
            signal
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`${provider.provider_name} API HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        return { success: !!text, text };
    }

    /**
     * Cloudflare Workers AI REST Adapter
     */
    async callCloudflareAI(provider, rawText, systemPrompt, signal) {
        const accountId = provider.account_id || env.CLOUDFLARE_ACCOUNT_ID;
        const model = provider.model_name || "@cf/meta/llama-3.3-70b-instruct";
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

        const payload = {
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: rawText }
            ]
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${provider.api_key_encrypted}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Workers AI HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const text = data.result?.response || "";
        return { success: !!text, text };
    }

    /**
     * Tag Sanitization & Auto-Repair for Telegram HTML compatibility
     * Strips backticks/markdown fences and auto-closes unclosed <b> tags
     */
    cleanOutput(text) {
        if (!text) return "";

        // Remove markdown code fences ```html or ```
        let cleaned = text.replace(/```(?:html|HTML)?/g, '').replace(/```/g, '').trim();

        // Count opening and closing <b> tags and balance them
        const openMatches = (cleaned.match(/<b>/gi) || []).length;
        const closeMatches = (cleaned.match(/<\/b>/gi) || []).length;

        if (openMatches > closeMatches) {
            const missing = openMatches - closeMatches;
            cleaned += '</b>'.repeat(missing);
        }

        return cleaned;
    }
}
