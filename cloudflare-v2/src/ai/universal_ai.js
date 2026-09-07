/**
 * UNIVERSAL MULTI-AI CASCADE ENGINE FOR CLOUDFLARE WORKERS
 *
 * AI is a bounded interpretation/formatting service. Machine execution must
 * validate any AI-derived structure independently before authorizing orders.
 */
export class UniversalAIRouter {
    constructor(providers = [], options = {}) {
        this.providers = Array.isArray(providers)
            ? [...providers].sort((a, b) => this.priorityOf(a) - this.priorityOf(b))
            : [];
        this.env = options.env || {};
        this.fetchFn = options.fetchFn || fetch;
        this.credentialResolver = options.credentialResolver || null;
        this.workspaceId = String(options.workspaceId ?? '').trim() || null;
        this.circuitBreaker = options.circuitBreaker || null;
    }

    priorityOf(provider) {
        return Number(provider?.priority_rank ?? provider?.priority ?? 1);
    }

    circuitKey(provider, purpose) {
        const providerId = String(provider?.id ?? '').trim();
        const purposeName = String(purpose ?? '').trim();
        if (!this.workspaceId || !providerId || !purposeName) return null;
        return { purpose: purposeName, provider: providerId, workspaceId: this.workspaceId };
    }

    canAttemptCircuit(key) {
        if (!key || typeof this.circuitBreaker?.canAttempt !== 'function') return true;
        try {
            return this.circuitBreaker.canAttempt(key)?.allowed !== false;
        } catch {
            return true;
        }
    }

    recordCircuitFailure(key) {
        if (!key || typeof this.circuitBreaker?.recordFailure !== 'function') return;
        try { this.circuitBreaker.recordFailure(key); } catch {}
    }

    recordCircuitSuccess(key) {
        if (!key || typeof this.circuitBreaker?.recordSuccess !== 'function') return;
        try { this.circuitBreaker.recordSuccess(key); } catch {}
    }

    async resolveCredential(provider) {
        if (this.credentialResolver) {
            const resolved = await this.credentialResolver(provider);
            if (resolved) return resolved;
        }
        // Transitional compatibility only. Production migrations should move
        // tenant credentials to encrypted storage and inject a resolver.
        return provider?.resolved_api_key || provider?.api_key_encrypted || provider?.api_key || null;
    }

    /**
     * Attempts formatting/interpretation using providers in configured order.
     * `timeoutMs` is per provider, allowing Telegram formatting to use a much
     * smaller latency budget than non-urgent interpretation work. Circuit
     * identity is derived only from this router's trusted workspace binding
     * and the exact database provider row currently being attempted.
     */
    async processSignal(rawText, systemPrompt, { timeoutMs = 12000, purpose = 'ai' } = {}) {
        if (!this.providers.length) {
            return { success: false, error: 'No AI providers configured in database.' };
        }

        let attempted = 0;
        let blocked = 0;
        for (const provider of this.providers) {
            if (provider?.is_active === false) continue;

            const circuitKey = this.circuitKey(provider, purpose);
            if (!this.canAttemptCircuit(circuitKey)) {
                blocked += 1;
                continue;
            }

            let apiKey;
            try {
                apiKey = await this.resolveCredential(provider);
            } catch {
                attempted += 1;
                this.recordCircuitFailure(circuitKey);
                console.warn('AI provider credential resolution failed');
                continue;
            }
            if (!apiKey && !provider?.uses_binding) continue;

            attempted += 1;
            const resolvedProvider = { ...provider, resolved_api_key: apiKey };
            try {
                const result = await this.callProviderWithTimeout(resolvedProvider, rawText, systemPrompt, timeoutMs);
                if (result?.success && result.text) {
                    this.recordCircuitSuccess(circuitKey);
                    return {
                        success: true,
                        text: this.cleanOutput(result.text),
                        provider: provider.provider_name,
                        model: provider.model_name,
                    };
                }
                this.recordCircuitFailure(circuitKey);
            } catch {
                this.recordCircuitFailure(circuitKey);
                console.warn('AI provider request failed');
            }
        }

        if (attempted === 0 && blocked > 0) {
            return { success: false, error: 'AI_CIRCUIT_OPEN' };
        }
        return { success: false, error: 'All AI providers failed in cascade.' };
    }

    async callProviderWithTimeout(provider, rawText, systemPrompt, timeoutMs = 12000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await this.executeProviderCall(provider, rawText, systemPrompt, controller.signal);
        } catch (err) {
            if (err?.name === 'AbortError') throw new Error(`Timeout after ${timeoutMs}ms`);
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async executeProviderCall(provider, rawText, systemPrompt, signal) {
        const pType = String(provider.provider_name || '').toLowerCase();
        if (pType.includes('gemini') || pType.includes('google')) {
            return this.callGemini(provider, rawText, systemPrompt, signal);
        }
        if (pType.includes('cloudflare') || pType.includes('workers_ai')) {
            return this.callCloudflareAI(provider, rawText, systemPrompt, signal);
        }
        return this.callOpenAICompatible(provider, rawText, systemPrompt, signal);
    }

    async callGemini(provider, rawText, systemPrompt, signal) {
        const model = provider.model_name || 'gemini-2.5-flash';
        const key = provider.resolved_api_key;
        if (!key) throw new Error('Gemini credential missing');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const payload = {
            contents: [{ parts: [{ text: `${systemPrompt}\n\nInput Signal:\n${rawText}` }] }],
            generationConfig: {
                temperature: Number(provider.temperature ?? 0.1),
                maxOutputTokens: Number(provider.max_output_tokens ?? 1000),
            },
        };
        const res = await this.fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });
        if (!res.ok) throw new Error(`Gemini API HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { success: Boolean(text), text };
    }

    async callOpenAICompatible(provider, rawText, systemPrompt, signal) {
        const key = provider.resolved_api_key;
        if (!key) throw new Error(`${provider.provider_name} credential missing`);
        let baseUrl = provider.base_url || 'https://api.openai.com/v1';
        if (!baseUrl.endsWith('/chat/completions')) {
            baseUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
        }
        const providerName = String(provider.provider_name || '');
        const model = provider.model_name || (providerName.includes('deepseek') ? 'deepseek-chat' : 'gpt-4o-mini');
        const res = await this.fetchFn(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: rawText },
                ],
                temperature: Number(provider.temperature ?? 0.1),
                max_tokens: Number(provider.max_output_tokens ?? 1000),
            }),
            signal,
        });
        if (!res.ok) throw new Error(`${provider.provider_name} API HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        return { success: Boolean(text), text };
    }

    async callCloudflareAI(provider, rawText, systemPrompt, signal) {
        const accountId = provider.account_id || this.env.CLOUDFLARE_ACCOUNT_ID;
        const key = provider.resolved_api_key;
        if (!accountId) throw new Error('Cloudflare account id missing');
        if (!key) throw new Error('Cloudflare AI credential missing');
        const model = provider.model_name || '@cf/meta/llama-3.3-70b-instruct';
        const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
        const res = await this.fetchFn(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: rawText },
                ],
            }),
            signal,
        });
        if (!res.ok) throw new Error(`Workers AI HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = data.result?.response || '';
        return { success: Boolean(text), text };
    }

    cleanOutput(text) {
        if (!text) return '';
        let cleaned = String(text).replace(/```(?:html|HTML)?/g, '').replace(/```/g, '').trim();
        const openMatches = (cleaned.match(/<b>/gi) || []).length;
        const closeMatches = (cleaned.match(/<\/b>/gi) || []).length;
        if (openMatches > closeMatches) cleaned += '</b>'.repeat(openMatches - closeMatches);
        return cleaned;
    }
}