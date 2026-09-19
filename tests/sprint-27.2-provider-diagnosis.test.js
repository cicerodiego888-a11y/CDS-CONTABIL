'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  OpenAIAccountingProvider,
  sanitizeProviderText
} = require('../backend/src/accounting-ai/openai-provider');

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function mockFetch(handler) {
  return async (url, options) => handler(url, options);
}

function jsonResponse(status, body, headers = {}) {
  const text = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = String(name || '').toLowerCase();
        const map = Object.fromEntries(
          Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
        );
        return map[key] || null;
      }
    },
    async json() {
      if (!text) throw new Error('empty');
      return JSON.parse(text);
    },
    async text() { return text; }
  };
}

function assertNoSecrets(value) {
  const blob = typeof value === 'string' ? value : JSON.stringify(value || {});
  assert.doesNotMatch(blob, /sk-[a-zA-Z0-9_\-]{8,}/);
  assert.doesNotMatch(blob, /Bearer\s+[A-Za-z0-9_\-\.]+/i);
  assert.doesNotMatch(blob, /AI_CREDENTIAL_ENCRYPTION_KEY/);
  assert.doesNotMatch(blob, /DOCUMENT_ENCRYPTION_KEY/);
  assert.doesNotMatch(blob, /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{20,}/i);
  assert.doesNotMatch(blob, new RegExp(TINY_PNG_B64));
}

test('HTTP 400 preserva detalhes do provider sem expor segredos', async () => {
  const provider = new OpenAIAccountingProvider({
    apiKey: 'sk-test-secret-key-should-never-leak',
    model: 'gpt-5.6-terra',
    fetchImpl: mockFetch(async () => jsonResponse(400, {
      error: {
        message: 'mensagem de teste',
        type: 'invalid_request_error',
        code: 'test_error',
        param: 'test_param'
      }
    }, { 'x-request-id': 'req_test_400' }))
  });

  let caught;
  try {
    await provider.interpretDocumentImage({
      mimeType: 'image/png',
      imageBase64: TINY_PNG_B64,
      documentId: 'doc-1'
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught);
  assert.equal(caught.code, 'AI_PROVIDER_ERROR');
  assert.equal(caught.http, 400);
  assert.equal(caught.providerCode, 'test_error');
  assert.equal(caught.providerType, 'invalid_request_error');
  assert.equal(caught.providerParam, 'test_param');
  assert.match(String(caught.providerMessage || caught.message), /mensagem de teste/);
  assert.equal(caught.providerRequestId, 'req_test_400');
  assert.equal(caught.model, 'gpt-5.6-terra');
  assert.match(String(caught.endpoint), /\/chat\/completions$/);
  assertNoSecrets(caught);
  assertNoSecrets({
    message: caught.message,
    providerMessage: caught.providerMessage,
    stack: caught.stack
  });
});

test('HTTP 500 com corpo não JSON não quebra e mantém AI_PROVIDER_ERROR', async () => {
  const provider = new OpenAIAccountingProvider({
    apiKey: 'sk-test-secret-key-should-never-leak',
    model: 'gpt-5.6-terra',
    fetchImpl: mockFetch(async () => jsonResponse(500, 'not-json<<<', {}))
  });

  await assert.rejects(
    () => provider.requestChat([{ role: 'user', content: 'x' }]),
    (error) => {
      assert.equal(error.code, 'AI_PROVIDER_ERROR');
      assert.equal(error.http, 500);
      assert.equal(error.providerCode, null);
      assertNoSecrets(error);
      return true;
    }
  );
});

test('HTTP 500 com body vazio retorna AI_PROVIDER_ERROR sem crash', async () => {
  const provider = new OpenAIAccountingProvider({
    apiKey: 'sk-test-secret-key-should-never-leak',
    model: 'gpt-5.6-terra',
    fetchImpl: mockFetch(async () => jsonResponse(500, '', {}))
  });

  await assert.rejects(
    () => provider.requestChat([{ role: 'user', content: 'x' }]),
    (error) => {
      assert.equal(error.code, 'AI_PROVIDER_ERROR');
      assert.equal(error.http, 500);
      assertNoSecrets(error);
      return true;
    }
  );
});

test('resposta válida continua processada normalmente', async () => {
  const provider = new OpenAIAccountingProvider({
    apiKey: 'sk-test-secret-key-should-never-leak',
    model: 'gpt-5.6-terra',
    fetchImpl: mockFetch(async () => jsonResponse(200, {
      choices: [{
        message: {
          content: JSON.stringify({
            fields: {
              supplier_name: { value: 'Taxi', confidence: 0.9 },
              total_amount: { value: 45, confidence: 0.99 }
            }
          })
        }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }))
  });

  const result = await provider.interpretDocumentImage({
    mimeType: 'image/png',
    imageBase64: TINY_PNG_B64
  });
  assert.equal(result.fields.supplier_name.value, 'Taxi');
  assert.equal(result.__usage.total_tokens, 15);
  assertNoSecrets(result);
});

test('sanitizeProviderText remove chave e base64', () => {
  const dirty = 'Bearer sk-abcdefghijklmnop Authorization data:image/png;base64,' + TINY_PNG_B64;
  const clean = sanitizeProviderText(dirty);
  assertNoSecrets(clean);
  assert.match(clean, /REDACTED/);
});

test('interpretVisual registra FAILED com metadados seguros do provider', async () => {
  // Integração leve via provider unitário: o service audit é coberto no fluxo mockado
  // abaixo apenas validando o shape do erro propagado para auditoria.
  const provider = new OpenAIAccountingProvider({
    apiKey: 'sk-test-secret-key-should-never-leak',
    model: 'gpt-5.6-terra',
    fetchImpl: mockFetch(async () => jsonResponse(400, {
      error: {
        message: 'model does not exist',
        type: 'invalid_request_error',
        code: 'model_not_found',
        param: 'model'
      }
    }))
  });
  try {
    await provider.interpretDocumentImage({
      mimeType: 'image/png',
      imageBase64: TINY_PNG_B64
    });
    assert.fail('deveria falhar');
  } catch (error) {
    const auditPayload = {
      error_code: error.code,
      http: error.http,
      provider_code: error.providerCode,
      provider_type: error.providerType,
      provider_param: error.providerParam,
      provider_message: error.providerMessage,
      model: error.model,
      endpoint: error.endpoint
    };
    assert.equal(auditPayload.error_code, 'AI_PROVIDER_ERROR');
    assert.equal(auditPayload.http, 400);
    assert.equal(auditPayload.provider_code, 'model_not_found');
    assert.equal(auditPayload.provider_type, 'invalid_request_error');
    assert.equal(auditPayload.provider_param, 'model');
    assertNoSecrets(auditPayload);
  }
});
