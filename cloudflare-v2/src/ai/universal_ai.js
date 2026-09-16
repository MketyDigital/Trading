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
        this.nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => new Date();
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
        return provider?.resolved_api_key || provider?.api_key_encrypted || provider?.api_key || null;
    }

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

    requireModel(provider) {
        const model = String(provider?.model_name ?? '').trim();
        if (!model) throw new Error('AI_MODEL_NOT_CONFIGURED');
        return model;
    }

    providerConfig(provider) {
        return provider?.provider_config && typeof provider.provider_config === 'object' && !Array.isArray(provider.provider_config)
            ? provider.provider_config
            : {};
    }

    async executeProviderCall(provider, rawText, systemPrompt, signal) {
        const pType = String(provider.provider_name || '').toLowerCase();
        if (pType === 'azure_openai') return this.callAzureOpenAIResponses(provider, rawText, systemPrompt, signal);
        if (pType === 'vertex_ai') return this.callVertexAI(provider, rawText, systemPrompt, signal);
        if (pType === 'aws_bedrock') return this.callBedrock(provider, rawText, systemPrompt, signal);
        if (pType === 'gemini' || pType === 'google') return this.callGemini(provider, rawText, systemPrompt, signal);
        if (pType === 'cloudflare_ai' || pType === 'workers_ai') return this.callCloudflareAI(provider, rawText, systemPrompt, signal);
        if (pType === 'openai' || pType.startsWith('openai_')) return this.callOpenAIResponses(provider, rawText, systemPrompt, signal);
        return this.callOpenAICompatible(provider, rawText, systemPrompt, signal);
    }

    async callGemini(provider, rawText, systemPrompt, signal) {
        const model = this.requireModel(provider);
        const key = provider.resolved_api_key;
        if (!key) throw new Error('Gemini credential missing');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const payload = {
            contents: [{ parts: [{ text: `${systemPrompt}\n\nInput Signal:\n${rawText}` }] }],
            generationConfig: {
                temperature: Number(provider.temperature ?? 0.1),
                maxOutputTokens: Number(provider.max_output_tokens ?? 1000),
            },
        };
        const res = await this.fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(payload),
            signal,
        });
        if (!res.ok) throw new Error(`Gemini API HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { success: Boolean(text), text };
    }

    responseText(data = {}) {
        if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
        for (const item of Array.isArray(data.output) ? data.output : []) {
            if (item?.type !== 'message') continue;
            for (const content of Array.isArray(item.content) ? item.content : []) {
                if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string' && content.text.trim()) {
                    return content.text;
                }
            }
        }
        return '';
    }

    async callOpenAIResponses(provider, rawText, systemPrompt, signal) {
        const key = provider.resolved_api_key;
        if (!key) throw new Error('OpenAI credential missing');
        let baseUrl = provider.base_url || 'https://api.openai.com/v1';
        if (!baseUrl.endsWith('/responses')) baseUrl = baseUrl.replace(/\/+$/, '') + '/responses';
        const model = this.requireModel(provider);
        const res = await this.fetchFn(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                model,
                instructions: systemPrompt,
                input: rawText,
                max_output_tokens: Number(provider.max_output_tokens ?? 1000),
            }),
            signal,
        });
        if (!res.ok) throw new Error(`OpenAI API HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = this.responseText(data);
        return { success: Boolean(text), text };
    }

    async callAzureOpenAIResponses(provider, rawText, systemPrompt, signal) {
        const key = provider.resolved_api_key;
        if (!key) throw new Error('Azure OpenAI credential missing');
        let baseUrl = String(provider.base_url || '').trim();
        if (!baseUrl) throw new Error('Azure OpenAI endpoint missing');
        if (!baseUrl.endsWith('/responses')) baseUrl = baseUrl.replace(/\/+$/, '') + '/responses';
        const model = this.requireModel(provider);
        const res = await this.fetchFn(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'api-key': key },
            body: JSON.stringify({
                model,
                instructions: systemPrompt,
                input: rawText,
                max_output_tokens: Number(provider.max_output_tokens ?? 1000),
            }),
            signal,
        });
        if (!res.ok) throw new Error(`Azure OpenAI HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = this.responseText(data);
        return { success: Boolean(text), text };
    }

    async callVertexAI(provider, rawText, systemPrompt, signal) {
        const key = provider.resolved_api_key;
        if (!key) throw new Error('Vertex AI OAuth credential missing');
        const config = this.providerConfig(provider);
        const projectId = String(config.project_id ?? config.projectId ?? '').trim();
        const location = String(config.location ?? '').trim();
        if (!projectId) throw new Error('Vertex AI project id missing');
        if (!location) throw new Error('Vertex AI location missing');
        const model = this.requireModel(provider);
        const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
        const payload = {
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nInput Signal:\n${rawText}` }] }],
            generationConfig: {
                temperature: Number(provider.temperature ?? 0.1),
                maxOutputTokens: Number(provider.max_output_tokens ?? 1000),
            },
        };
        const res = await this.fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(payload),
            signal,
        });
        if (!res.ok) throw new Error(`Vertex AI HTTP ${res.status}: ${await res.text()}`);
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
        const model = this.requireModel(provider);
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
        const accountId = String(provider.account_id ?? this.providerConfig(provider).account_id ?? '').trim();
        const key = provider.resolved_api_key;
        if (!accountId) throw new Error('Cloudflare account id missing');
        if (!key) throw new Error('Cloudflare AI credential missing');
        const model = this.requireModel(provider);
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

    utf8(value) {
        return new TextEncoder().encode(String(value));
    }

    hex(bytes) {
        return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
    }

    async sha256(value) {
        return this.hex(await crypto.subtle.digest('SHA-256', this.utf8(value)));
    }

    async hmac(key, value, raw = false) {
        const keyBytes = typeof key === 'string' ? this.utf8(key) : key;
        const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, this.utf8(value));
        return raw ? new Uint8Array(signature) : this.hex(signature);
    }

    awsTimestamp(date) {
        return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    }

    async callBedrock(provider, rawText, systemPrompt, signal) {
        const config = this.providerConfig(provider);
        const region = String(config.region ?? '').trim();
        if (!region) throw new Error('Bedrock region missing');
        const model = this.requireModel(provider);
        let credential;
        try {
            credential = JSON.parse(String(provider.resolved_api_key || ''));
        } catch {
            throw new Error('Bedrock credential invalid');
        }
        const accessKeyId = String(credential?.accessKeyId ?? credential?.access_key_id ?? '').trim();
        const secretAccessKey = String(credential?.secretAccessKey ?? credential?.secret_access_key ?? '').trim();
        const sessionToken = String(credential?.sessionToken ?? credential?.session_token ?? '').trim();
        if (!accessKeyId || !secretAccessKey) throw new Error('Bedrock credential invalid');

        const host = `bedrock-runtime.${region}.amazonaws.com`;
        const canonicalUri = `/model/${model}/converse`;
        const url = `https://${host}${canonicalUri}`;
        const payload = JSON.stringify({
            system: [{ text: systemPrompt }],
            messages: [{ role: 'user', content: [{ text: rawText }] }],
        });
        const now = this.nowFn();
        const amzDate = this.awsTimestamp(now);
        const dateStamp = amzDate.slice(0, 8);
        const payloadHash = await this.sha256(payload);
        const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n${sessionToken ? `x-amz-security-token:${sessionToken}\n` : ''}`;
        const signedHeaders = sessionToken
            ? 'content-type;host;x-amz-date;x-amz-security-token'
            : 'content-type;host;x-amz-date';
        const canonicalRequest = `POST\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
        const credentialScope = `${dateStamp}/${region}/bedrock/aws4_request`;
        const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await this.sha256(canonicalRequest)}`;
        const kDate = await this.hmac(`AWS4${secretAccessKey}`, dateStamp, true);
        const kRegion = await this.hmac(kDate, region, true);
        const kService = await this.hmac(kRegion, 'bedrock', true);
        const kSigning = await this.hmac(kService, 'aws4_request', true);
        const signature = await this.hmac(kSigning, stringToSign);
        const headers = {
            'Content-Type': 'application/json',
            'x-amz-date': amzDate,
            Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        };
        if (sessionToken) headers['x-amz-security-token'] = sessionToken;

        const res = await this.fetchFn(url, { method: 'POST', headers, body: payload, signal });
        if (!res.ok) throw new Error(`Bedrock HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = data.output?.message?.content?.[0]?.text || '';
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