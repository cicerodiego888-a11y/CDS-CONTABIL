'use strict';

/**
 * Contrato conceitual ExportAdapter:
 *   validate(context) → { ok, errors, preview }
 *   normalize(entries) → entries
 *   generate(entries, options) → { text, encoding, fileName, contentType, lineCount, meta }
 *   metadata() → { system_key, label, layout, ... }
 */

function createAdapterRegistry() {
  const adapters = new Map();
  function register(adapter) {
    if (!adapter || !adapter.metadata) throw new Error('ADAPTER_INVALID');
    const meta = adapter.metadata();
    if (!meta.system_key) throw new Error('ADAPTER_SYSTEM_KEY_REQUIRED');
    adapters.set(meta.system_key, adapter);
    return adapter;
  }
  function get(systemKey) {
    return adapters.get(String(systemKey || '')) || null;
  }
  function list() {
    return [...adapters.values()].map(a => a.metadata());
  }
  return { register, get, list };
}

module.exports = { createAdapterRegistry };
