'use strict';

/**
 * Diagnóstico controlado Sprint 27.2 — NÃO imprime segredos.
 * Uso: AI_DEBUG=true node scripts/diag-openai-visual.js
 */
const path = require('path');
const fs = require('fs');

process.env.AI_DEBUG = process.env.AI_DEBUG || 'true';

const { loadConfig } = require('../backend/src/config');
const { openDatabase } = require('../backend/src/database');
const { createAiCredentialService } = require('../backend/src/ai-credentials/service');
const { OpenAIAccountingProvider } = require('../backend/src/accounting-ai/openai-provider');

const ROOT = path.resolve(__dirname, '..');
const config = loadConfig(process.env);
const db = openDatabase({
  dbPath: config.CDS_DB_PATH,
  schemaDir: path.join(ROOT, 'database', 'schema'),
  uploads: [config.UPLOAD_DIR]
});

const id = () => require('crypto').randomUUID();
const credentials = createAiCredentialService({ db, id, auditSystem: null, config, testConnection: async () => ({ ok: true }) });

const png = fs.readFileSync
  ? Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  : null;

async function main() {
  let apiKey = '';
  let source = null;
  try {
    const resolved = credentials.resolveApiKey();
    apiKey = resolved.apiKey || '';
    source = resolved.source;
  } catch (e) {
    console.error(JSON.stringify({
      ok: false,
      stage: 'resolve_credential',
      code: e.code || null,
      message: e.message || String(e)
    }));
    process.exit(2);
  }

  if (!apiKey) {
    console.error(JSON.stringify({
      ok: false,
      stage: 'resolve_credential',
      message: 'Nenhuma credencial disponível (cofre/env).'
    }));
    process.exit(2);
  }

  const provider = new OpenAIAccountingProvider({
    apiKey,
    model: config.AI_MODEL,
    baseUrl: config.OPENAI_BASE_URL,
    timeoutMs: config.AI_TIMEOUT_MS,
    debug: true
  });

  const started = new Date().toISOString();
  const report = {
    started_at: started,
    endpoint: provider.chatEndpoint(),
    model: config.AI_MODEL,
    mime_type: 'image/png',
    image_size_bytes: png.length,
    base64_size: png.toString('base64').length,
    credential_source: source,
    success: false
  };

  try {
    await provider.interpretDocumentImage({
      documentId: 'diag-27-2',
      mimeType: 'image/png',
      imageBase64: png.toString('base64')
    });
    report.success = true;
    report.http_status = 200;
  } catch (error) {
    report.success = false;
    report.http_status = error.http != null ? error.http : null;
    report.error_code = error.code || null;
    report.provider_code = error.providerCode || null;
    report.provider_type = error.providerType || null;
    report.provider_param = error.providerParam || null;
    report.provider_message = error.providerMessage || error.message || null;
    report.provider_request_id = error.providerRequestId || null;
    report.phase = error.http ? 'response' : 'request_or_transport';
  }

  const blob = JSON.stringify(report);
  if (/sk-[a-zA-Z0-9_\-]{8,}/.test(blob) || /Bearer /i.test(blob)) {
    console.error(JSON.stringify({ ok: false, message: 'Abortado: possível vazamento de segredo no relatório.' }));
    process.exit(3);
  }

  console.log(JSON.stringify(report, null, 2));
  db.close();
  process.exit(report.success ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, message: String(e && e.message || e) }));
  try { db.close(); } catch {}
  process.exit(1);
});
