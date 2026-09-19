'use strict';

const { AccountingAIProvider } = require('./provider');
const { VISUAL_SYSTEM_PROMPT, isVisualMime } = require('../document-intelligence/visual');

function jsonFromContent(content) {
  if (content && typeof content === 'object') return content;
  const text = String(content || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(text);
}

function usageFromBody(body) {
  if (!body || !body.usage) return null;
  return {
    input_tokens: Number(body.usage.prompt_tokens || 0),
    output_tokens: Number(body.usage.completion_tokens || 0),
    total_tokens: Number(body.usage.total_tokens || 0),
    cached_input_tokens: Number(
      (body.usage.prompt_tokens_details && body.usage.prompt_tokens_details.cached_tokens) ||
      body.usage.cached_tokens ||
      0
    )
  };
}

function isAiDebugEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.AI_DEBUG || '').trim());
}

/** Remove possíveis vazamentos de segredo de textos de erro/log. */
function sanitizeProviderText(value) {
  let text = String(value == null ? '' : value);
  text = text.replace(/sk-[a-zA-Z0-9_\-]{8,}/g, '[REDACTED]');
  text = text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
  text = text.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:image/...;base64,[REDACTED]');
  text = text.replace(/AI_CREDENTIAL_ENCRYPTION_KEY[=:]\s*\S+/gi, 'AI_CREDENTIAL_ENCRYPTION_KEY=[REDACTED]');
  text = text.replace(/DOCUMENT_ENCRYPTION_KEY[=:]\s*\S+/gi, 'DOCUMENT_ENCRYPTION_KEY=[REDACTED]');
  text = text.replace(/OPENAI_API_KEY[=:]\s*\S+/gi, 'OPENAI_API_KEY=[REDACTED]');
  return text.slice(0, 500);
}

function providerRequestId(response) {
  if (!response || !response.headers || typeof response.headers.get !== 'function') return null;
  return response.headers.get('x-request-id') ||
    response.headers.get('x-openai-request-id') ||
    null;
}

function debugVisualLog(payload) {
  if (!isAiDebugEnabled()) return;
  const safe = Object.assign({ tag: 'AI_VISUAL_DEBUG' }, payload || {});
  delete safe.image_base64;
  delete safe.api_key;
  delete safe.Authorization;
  delete safe.authorization;
  delete safe.prompt;
  delete safe.messages;
  delete safe.body;
  console.info('[AI_VISUAL_DEBUG]', JSON.stringify(safe));
}

async function readProviderErrorBody(response) {
  if (!response) return { rawText: '', parsed: null };
  let rawText = '';
  try {
    rawText = await response.text();
  } catch {
    return { rawText: '', parsed: null };
  }
  if (!rawText || !String(rawText).trim()) return { rawText: '', parsed: null };
  try {
    return { rawText: String(rawText).slice(0, 2000), parsed: JSON.parse(rawText) };
  } catch {
    return { rawText: String(rawText).slice(0, 200), parsed: null };
  }
}

function attachProviderErrorFields(error, details = {}) {
  error.code = details.code || 'AI_PROVIDER_ERROR';
  if (details.http != null) error.http = details.http;
  error.providerCode = details.providerCode != null ? details.providerCode : null;
  error.providerType = details.providerType != null ? details.providerType : null;
  error.providerParam = details.providerParam != null ? details.providerParam : null;
  error.providerMessage = details.providerMessage
    ? sanitizeProviderText(details.providerMessage)
    : null;
  error.providerRequestId = details.providerRequestId || null;
  error.endpoint = details.endpoint || null;
  error.model = details.model || null;
  return error;
}

class OpenAIAccountingProvider extends AccountingAIProvider {
  constructor(options = {}) {
    super('openai', options.model || 'gpt-5.6-terra');
    this.apiKey = String(options.apiKey || '');
    this.baseUrl = String(options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 30000));
    this.fetch = options.fetchImpl || global.fetch;
    this.debug = options.debug != null ? !!options.debug : isAiDebugEnabled();
  }

  isConfigured() {
    return !!(this.apiKey && this.fetch);
  }

  chatEndpoint() {
    return this.baseUrl + '/chat/completions';
  }

  async requestChat(messages, meta = {}) {
    if (!this.isConfigured()) {
      const error = new Error('Sugestão inteligente indisponível.');
      error.code = 'AI_NOT_CONFIGURED';
      throw error;
    }
    const endpoint = this.chatEndpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: 'Bearer ' + this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages
        })
      });
    } catch (cause) {
      const error = new Error('Sugestão inteligente indisponível.');
      attachProviderErrorFields(error, {
        code: cause && cause.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR',
        endpoint,
        model: this.model,
        providerMessage: cause && cause.message ? sanitizeProviderText(cause.message) : null
      });
      if (this.debug || isAiDebugEnabled()) {
        debugVisualLog({
          phase: 'request_transport',
          model: this.model,
          endpoint,
          mime_type: meta.mimeType || null,
          image_size_bytes: meta.imageSizeBytes != null ? meta.imageSizeBytes : null,
          base64_size: meta.base64Size != null ? meta.base64Size : null,
          error_code: error.code
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const { parsed } = await readProviderErrorBody(response);
      const providerError = (parsed && parsed.error && typeof parsed.error === 'object')
        ? parsed.error
        : {};
      const providerMessage = sanitizeProviderText(
        providerError.message || 'Sugestão inteligente indisponível.'
      );
      const error = new Error(
        providerMessage || 'Sugestão inteligente indisponível.'
      );
      attachProviderErrorFields(error, {
        code: 'AI_PROVIDER_ERROR',
        http: response.status,
        providerCode: providerError.code != null ? String(providerError.code) : null,
        providerType: providerError.type != null ? String(providerError.type) : null,
        providerParam: providerError.param != null ? String(providerError.param) : null,
        providerMessage,
        providerRequestId: providerRequestId(response),
        endpoint,
        model: this.model
      });
      if (this.debug || isAiDebugEnabled()) {
        debugVisualLog({
          phase: 'response_error',
          model: this.model,
          endpoint,
          mime_type: meta.mimeType || null,
          image_size_bytes: meta.imageSizeBytes != null ? meta.imageSizeBytes : null,
          base64_size: meta.base64Size != null ? meta.base64Size : null,
          http_status: response.status,
          provider_code: error.providerCode,
          provider_type: error.providerType,
          provider_param: error.providerParam,
          request_id: error.providerRequestId
        });
      }
      throw error;
    }

    let body;
    try { body = await response.json(); } catch {
      const error = new Error('Resposta inválida do provedor de IA.');
      attachProviderErrorFields(error, {
        code: 'AI_INVALID_RESPONSE',
        http: response.status,
        endpoint,
        model: this.model,
        providerRequestId: providerRequestId(response)
      });
      throw error;
    }
    try {
      const result = jsonFromContent(body && body.choices && body.choices[0] &&
        body.choices[0].message && body.choices[0].message.content);
      Object.defineProperty(result, '__usage', {
        enumerable: false,
        value: usageFromBody(body)
      });
      if (this.debug || isAiDebugEnabled()) {
        debugVisualLog({
          phase: 'response_ok',
          model: this.model,
          endpoint,
          mime_type: meta.mimeType || null,
          image_size_bytes: meta.imageSizeBytes != null ? meta.imageSizeBytes : null,
          base64_size: meta.base64Size != null ? meta.base64Size : null,
          http_status: response.status,
          request_id: providerRequestId(response)
        });
      }
      return result;
    } catch {
      const error = new Error('Resposta inválida do provedor de IA.');
      attachProviderErrorFields(error, {
        code: 'AI_INVALID_RESPONSE',
        http: response.status,
        endpoint,
        model: this.model,
        providerRequestId: providerRequestId(response)
      });
      throw error;
    }
  }

  async call(system, payload) {
    return this.requestChat([
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(payload) }
    ]);
  }

  suggestClassification(context) {
    return this.call(
      'Você é um assistente contábil. Escolha exclusivamente IDs fornecidos. Não invente contas, categorias ou bancos. Retorne JSON com operation_type, history, category_id, bank_id, reason e candidates (account_id, confidence de 0 a 1, reason), no máximo 3 candidatos.',
      context
    );
  }

  suggestChart(context) {
    return this.call(
      'Estruture uma proposta de plano de contas sem gravar dados. Retorne JSON com rows. Cada row deve conter code, classification_code, description, account_type S ou A e parent_code quando aplicável. Não omita hierarquia identificável.',
      context
    );
  }

  async interpretDocumentImage(input = {}) {
    const mimeType = String(input.mimeType || '').toLowerCase();
    const imageBase64 = input.imageBase64 ? String(input.imageBase64) : '';
    const textExcerpt = input.textExcerpt ? String(input.textExcerpt).slice(0, 4000) : '';
    const hasImage = !!(imageBase64 && isVisualMime(mimeType));
    if (!hasImage && !textExcerpt) {
      const error = new Error('Formato visual não suportado para interpretação.');
      error.code = 'DOCUMENT_VISUAL_FORMAT_UNSUPPORTED';
      error.http = 422;
      throw error;
    }
    const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    const imageSizeBytes = hasImage
      ? Math.floor((imageBase64.length * 3) / 4) -
        (imageBase64.endsWith('==') ? 2 : imageBase64.endsWith('=') ? 1 : 0)
      : 0;
    const meta = {
      mimeType: hasImage ? normalizedMime : null,
      imageSizeBytes: hasImage ? imageSizeBytes : null,
      base64Size: hasImage ? imageBase64.length : null
    };
    if (this.debug || isAiDebugEnabled()) {
      debugVisualLog({
        phase: 'request_build',
        model: this.model,
        endpoint: this.chatEndpoint(),
        mime_type: meta.mimeType,
        image_size_bytes: meta.imageSizeBytes,
        base64_size: meta.base64Size,
        has_image: hasImage,
        has_text_excerpt: !!textExcerpt,
        response_format: 'json_object',
        temperature: 0
      });
    }
    const userContent = hasImage
      ? [
          {
            type: 'text',
            text: [
              'Interprete o documento na imagem.',
              'documentId=' + String(input.documentId || ''),
              textExcerpt ? ('Trecho auxiliar (pode estar incompleto):\n' + textExcerpt) : ''
            ].filter(Boolean).join('\n')
          },
          {
            type: 'image_url',
            image_url: {
              url: 'data:' + normalizedMime + ';base64,' + imageBase64
            }
          }
        ]
      : [
          {
            type: 'text',
            text: [
              'Interprete o conteúdo textual insuficiente do documento.',
              'documentId=' + String(input.documentId || ''),
              'Conteúdo:',
              textExcerpt
            ].join('\n')
          }
        ];
    return this.requestChat([
      { role: 'system', content: VISUAL_SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ], meta);
  }
}

module.exports = {
  OpenAIAccountingProvider,
  jsonFromContent,
  sanitizeProviderText,
  attachProviderErrorFields,
  readProviderErrorBody,
  isAiDebugEnabled
};
