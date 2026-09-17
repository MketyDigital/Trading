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
        this.fetchFn = typeof options.fetchFn === 'function'
            ? (...args) => options.fetchFn(...args)
            : (...args) => fetch(...args);
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

    providerIdentity(provider = {}) {
        return {
            providerId: String(provider?.id ?? '').trim() || null,
            providerType: String(provider?.provider_name ?? '').trim().toLowerCase() || null,
            model: String(provider?.model_name ?? '').trim() || null,
        };
    }

    optionalNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }

    sanitizeProviderMessage(message, provider = {}) {
        let value = String(message ?? '').replace(/\s+/g, ' ').trim();
        if (!value) return null;

        const secrets = [
            provider?.resolved_api_key,
            provider?.api_key,
            provider?.api_key_encrypted,
            provider?.api_key_ciphertext,
        ].filter((secret) => typeof secret === 'string' && secret.length >= 4);
        for (const secret of secrets) {
            value = value.split(secret).join('[REDACTED]');
        }

        value = value
            .replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, 'Bearer [REDACTED]')
            .replace(/(api[_ -]?key\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
            .replace(/(secret(?:_access)?_?key\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');

        return value.slice(0, 240);
    }

    providerFailure(message, {
        httpStatus = null,
        providerCode = null,
        retryable = false,
        errorClass = 'PROVIDER',
        sanitizedMessage = null,
    } = {}) {
        const error = new Error(message || sanitizedMessage || 'AI provider request failed');
        error.httpStatus = this.optionalNumber(httpStatus);
        error.providerCode = providerCode ? String(providerCode) : null;
        error.retryable = Boolean(retryable);
        error.errorClass = String(errorClass || 'PROVIDER');
        error.sanitizedMessage = sanitizedMessage ? String(sanitizedMessage) : null;
        return error;
    }

    httpErrorClass(status) {
        const value = Number(status);
        if (value === 401 || value === 403) return 'AUTH';
        if (value === 408) return 'TIMEOUT';
        if (value === 429) return 'RATE_LIMIT';
        if (value >= 500) return 'UPSTREAM';
        if (value >= 400) return 'REQUEST';
        return 'PROVIDER';
    }

    httpRetryable(status) {
        const value = Number(status);
        return value === 408 || value === 409 || value === 425 || value === 429 || value >= 500;
    }

    async responseFailure(res, provider, label) {
        const httpStatus = this.optionalNumber(res?.status);
        let raw = '';
        try { raw = await res.text(); } catch {}

        let payload = null;
        try { payload = raw ? JSON.parse(raw) : null; } catch {}
        const candidate = payload?.error && typeof payload.error === 'object'
            ? payload.error
            : Array.isArray(payload?.errors) && payload.errors[0] && typeof payload.errors[0] === 'object'
                ? payload.errors[0]
                : payload && typeof payload === 'object'
                    ? payload
                    : null;
        const providerCode = candidate?.code ?? candidate?.type ?? payload?.code ?? null;
        const extractedMessage = candidate?.message
            ?? candidate?.description
            ?? payload?.message
            ?? `${label} request failed`;
        const sanitizedMessage = this.sanitizeProviderMessage(extractedMessage, provider)
            || `${label} request failed`;

        return this.providerFailure(`${label} HTTP ${httpStatus ?? 'error'}`, {
            httpStatus,
            providerCode: providerCode || (httpStatus != null ? `HTTP_${httpStatus}` : 'AI_PROVIDER_HTTP_ERROR'),
            retryable: httpStatus != null ? this.httpRetryable(httpStatus) : true,
            errorClass: httpStatus != null ? this.httpErrorClass(httpStatus) : 'NETWORK',
            sanitizedMessage,
        });
    }

    normalizeFailure(err, provider, latencyMs, overrides = {}) {
        const message = this.sanitizeProviderMessage(
            overrides.sanitizedMessage ?? err?.sanitizedMessage ?? err?.message ?? 'AI provider request failed',
            provider,
        ) || 'AI provider request failed';
        const httpStatus = this.optionalNumber(overrides.httpStatus ?? err?.httpStatus ?? null);
        const providerCode = overrides.providerCode ?? err?.providerCode ?? null;
        let errorClass = overrides.errorClass ?? err?.errorClass ?? null;
        let retryable = overrides.retryable ?? err?.retryable;

        if (!errorClass) {
            if (httpStatus != null) errorClass = this.httpErrorClass(httpStatus);
            else if (err?.name === 'TypeError') errorClass = 'NETWORK';
            else if (/credential|api key/i.test(message)) errorClass = 'CREDENTIAL';
            else if (/missing|not configured|invalid/i.test(message)) errorClass = 'CONFIG';
            else errorClass = 'PROVIDER';
        }
        if (retryable == null) {
            if (httpStatus != null) retryable = this.httpRetryable(httpStatus);
            else retryable = errorClass === 'NETWORK' || errorClass === 'TIMEOUT';
        }

        return {
            ...this.providerIdentity(provider),
            outcome: 'FAILED',
            latencyMs: Math.max(0, Number(latencyMs) || 0),
            ...(httpStatus != null ? { httpStatus } : {}),
            ...(providerCode ? { providerCode: String(providerCode) } : {}),
            retryable: Boolean(retryable),
            errorClass: String(errorClass),
            sanitizedMessage: message,
        };
    }

    successDiagnostic(provider, result, latencyMs) {
        const httpStatus = this.optionalNumber(result?.httpStatus);
        return {
            ...this.providerIdentity(provider),
            outcome: 'SUCCESS',
            latencyMs: Math.max(0, Number(latencyMs) || 0),
            ...(httpStatus != null ? { httpStatus } : {}),
            ...(result?.providerCode ? { providerCode: String(result.providerCode) } : {}),
            retryable: false,
        };
    }

    async resolveCredential(provider) {
        if (this.credentialResolver) {
            const resolved = await this.credentialResolver(provider);
            if (resolved) return resolved;
        }
        return provider?.resolved_api_key || provider?.api_key_encrypted || provider?.api_key || null;
    }

    async processSignal(rawText, systemPrompt, { timeoutMs = 12000, purpose = 'ai' } = {}) {
        const diagnostics = [];
        if (!this.providers.length) {
            return { success: false, error: 'No AI providers configured in database.', diagnostics };
        }

        let attempted = 0;
        let blocked = 0;
        for (const provider of this.providers) {
            if (provider?.is_active === false) continue;

            const circuitKey = this.circuitKey(provider, purpose);
            if (!this.canAttemptCircuit(circuitKey)) {
                blocked += 1;
                diagnostics.push({
                    ...this.providerIdentity(provider),
                    outcome: 'BLOCKED',
                    latencyMs: 0,
                    providerCode: 'AI_CIRCUIT_OPEN',
                    retryable: true,
                    errorClass: 'CIRCUIT',
                    sanitizedMessage: 'AI provider circuit is open.',
                });
                continue;
            }

            let apiKey;
            const credentialStarted = Date.now();
            try {
                apiKey = await this.resolveCredential(provider);
            } catch (err) {
                attempted += 1;
                this.recordCircuitFailure(circuitKey);
                diagnostics.push(this.normalizeFailure(err, provider, Date.now() - credentialStarted, {
                    providerCode: 'AI_CREDENTIAL_RESOLUTION_FAILED',
                    retryable: false,
                    errorClass: 'CREDENTIAL',
                    sanitizedMessage: 'AI provider credential could not be resolved.',
                }));
                console.warn('AI provider credential resolution failed');
                continue;
            }
            if (!apiKey && !provider?.uses_binding) {
                attempted += 1;
                diagnostics.push(this.normalizeFailure(new Error('AI provider credential missing'), provider, Date.now() - credentialStarted, {
                    providerCode: 'AI_CREDENTIAL_MISSING',
                    retryable: false,
                    errorClass: 'CREDENTIAL',
                    sanitizedMessage: 'AI provider credential is not configured.',
                }));
                continue;
            }

            attempted += 1;
            const resolvedProvider = { ...provider, resolved_api_key: apiKey };
            const started = Date.now();
            try {
                const result = await this.callProviderWithTimeout(resolvedProvider, rawText, systemPrompt, timeoutMs);
                const latencyMs = Date.now() - started;
                if (result?.success && result.text) {
                    diagnostics.push(this.successDiagnostic(provider, result, latencyMs));
                    this.recordCircuitSuccess(circuitKey);
                    return {
                        success: true,
                        text: this.cleanOutput(result.text),
                        provider: provider.provider_name,
                        model: provider.model_name,
                        diagnostics,
                    };
                }
                diagnostics.push(this.normalizeFailure(new Error('AI provider returned no usable text'), resolvedProvider, latencyMs, {
                    providerCode: 'AI_EMPTY_RESPONSE',
                    retryable: false,
                    errorClass: 'EMPTY_RESPONSE',
                    sanitizedMessage: 'AI provider returned no usable output.',
                }));
                this.recordCircuitFailure(circuitKey);
            } catch (err) {
                diagnostics.push(this.normalizeFailure(err, resolvedProvider, Date.now() - started));
                this.recordCircuitFailure(circuitKey);
                console.warn('AI provider request failed');
            }
        }

        if (attempted === 0 && blocked > 0) {
            return { success: false, error: 'AI_CIRCUIT_OPEN', diagnostics };
        }
        return { success: false, error: 'All AI providers failed in cascade.', diagnostics };
    }

    async callProviderWithTimeout(provider, rawText, systemPrompt, timeoutMs = 12000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await this.executeProviderCall(provider, rawText, systemPrompt, controller.signal);
        } catch (err) {
            if (err?.name === 'AbortError') {
                throw this.providerFailure('AI provider request timed out', {
                    providerCode: 'AI_TIMEOUT',
                    retryable: true,
                    errorClass: 'TIMEOUT',
                    sanitizedMessage: `AI provider request timed out after ${timeoutMs}ms.`,
                });
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    requireModel(provider) {
        const model = String(provider?.model_name ?? '').trim();
        if (!model) throw this.providerFailure('AI model not configured', {
            providerCode: 'AI_MODEL_NOT_CONFIGURED',
            retryable: false,
            errorClass: 'CONFIG',
            sanitizedMessage: 'AI provider model is not configured.',
        });
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
        if (!key) throw this.providerFailure('Gemini credential missing', {
            providerCode: 'AI_CREDENTIAL_MISSING', errorClass: 'CREDENTIAL', sanitizedMessage: 'Gemini credential is not configured.',
        });
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
        if (!res.ok) throw await this.responseFailure(res, provider, 'Gemini API');
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { success: Boolean(text), text, httpStatus: Number(res.status) || 200 };
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
        if (!key) throw this.providerFailure('OpenAI credential missing', {
            providerCode: 'AI_CREDENTIAL_MISSING', errorClass: 'CREDENTIAL', sanitizedMessage: 'OpenAI credential is not configured.',
        });
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
        if (!res.ok) throw await this.responseFailure(res, provider, 'OpenAI API');
        const data = await res.json();
        const text = this.responseText(data);
        return { success: Boolean(text), text, httpStatus: Number(res.status) || 200 };
    }

    async callAzureOpenAIResponses(provider, rawText, systemPrompt, signal) {
        const key = provider.resolved_api_key;
        if (!key) throw this.providerFailure('Azure OpenAI credential missing', {
            providerCode: 'AI_CREDENTIAL_MISSING', errorClass: 'CREDENTIAL', sanitizedMessage: 'Azure OpenAI credential is not configured.',
        });
        let baseUrl = String(provider.base_url || '').trim();
        if (!baseUrl) throw this.providerFailure('Azure OpenAI endpoint missing', {
            providerCode: 'AI_ENDPOINT_MISSING', errorClass: 'CONFIG', sanitizedMessage: 'Azure OpenAI endpoint is not configured.',
        });
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
        if (!res.ok) throw await this.responseFailure(res, provider, 'Azure OpenAI');
        const data = await res.json();
        const text = this.responseText(data);
        return { success: Boolean(text), text, httpStatus: Number(res.status) || 200 };
    }

    async callVertexAI(provider, rawText, systemPrompt, signal) {
        const key = provider.resolved_api_key;
        if (!key) throw this.providerFailure('Vertex AI OAuth credential missing', {
            providerCode: 'AI_CREDENTIAL_MISSING', errorClass: 'CREDENTIAL', sanitizedMessage: 'Vertex AI OAuth credential is not configured.',
        });
        const config = this.providerConfig(provider);
        const projectId = String(config.project_id ?? config.projectId ?? '').trim();
        const location = String(config.location ?? '').trim();
        if (!projectId) throw this.providerFailure('Vertex AI project id missing', {
            providerCode: 'AI_PROJECT_MISSING', errorClass: 'CONFIG', sanitizedMessage: 'Vertex AI project is not configured.',
        });
        if (!location) throw this.providerFailure('Vertex AI location missing', {
            providerCode: 'AI_LOCATION_MISSING', errorClass: 'CONFIG', sanitizedMessage: 'Vertex AI location is not configured.',
        });
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
        if (!res.ok) throw await this.responseFailure(res, provider, 'Vertex AI');
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { success: Boolean(text), text, httpStatus: Number(res.status) || 200 };
    }

    async callOpenAICompatible(provider, rawText, systemPrompt, signal) {
        const key = provider.resolved_api_key;
        if (!key) throw this.providerFailure(`${provider.provider_name} credential missing`, {
            providerCode: 'AI_CREDENTIAL_MISSING', errorClass: 'CREDENTIAL', sanitizedMessage: 'AI provider credential is not configured.',
        });
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
        if (!res.ok) throw await this.responseFailure(res, provider, String(provider.provider_name || 'AI provider'));
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || '';
        return { success: Boolean(text), text, httpStatus: Number(res.status) || 200 };
    }

    async callCloudflareAI(provider, rawText, systemPrompt, signal) {
        const accountId = String(provider.account_id ?? this.providerConfig(provider).account_id ?? '').trim();
        const key = provider.resolved_api_key;
        if (!accountId) throw this.providerFailure('Cloudflare account id missing', {
            providerCode: 'AI_ACCOUNT_MISSING', errorClass: 'CONFIG', sanitizedMessage: 'Cloudflare AI account ID is not configured.',
        });
        if (!key) throw this.providerFailure('Cloudflare AI credential missing', {
            providerCode: 'AI_CREDENTIAL_MISSING', errorClass: 'CREDENTIAL', sanitizedMessage: 'Cloudflare AI credential is not configured.',
        });
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
        if (!res.ok) throw await this.responseFailure(res, provider, 'Workers AI');
        const data = await res.json();
        const text = data.result?.response || '';
        return { success: Boolean(text), text, httpStatus: Number(res.status) || 200 };
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
        if (!region) throw this.providerFailure('Bedrock region missing', {
            providerCode: 'AI_REGION_MISSING', errorClass: 'CONFIG', sanitizedMessage: 'AWS Bedrock region is not configured.',
        });
        const model = this.requireModel(provider);
        let credential;
        try {
            credential = JSON.parse(String(provider.resolved_api_key || ''));
        } catch {
            throw this.providerFailure('Bedrock credential invalid', {
                providerCode: 'AI_CREDENTIAL_INVALID', errorClass: 'CREDENTIAL', sanitizedMessage: 'AWS Bedrock credential is invalid.',
            });
        }
        const accessKeyId = String(credential?.accessKeyId ?? credential?.access_key_id ?? '').trim();
        const secretAccessKey = String(credential?.secretAccessKey ?? credential?.secret_access_key ?? '').trim();
        const sessionToken = String(credential?.sessionToken ?? credential?.session_token ?? '').trim();
        if (!accessKeyId || !secretAccessKey) throw this.providerFailure('Bedrock credential invalid', {
            providerCode: 'AI_CREDENTIAL_INVALID', errorClass: 'CREDENTIAL', sanitizedMessage: 'AWS Bedrock credential is invalid.',
        });

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
        if (!res.ok) throw await this.responseFailure(res, provider, 'Bedrock');
        const data = await res.json();
        const text = data.output?.message?.content?.[0]?.text || '';
        return { success: Boolean(text), text, httpStatus: Number(res.status) || 200 };
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