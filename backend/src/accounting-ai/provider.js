'use strict';

class AccountingAIProvider {
  constructor(name, model) {
    this.name = name || 'unknown';
    this.model = model || null;
  }

  isConfigured() {
    return true;
  }

  async suggestClassification() {
    throw new Error('AccountingAIProvider.suggestClassification deve ser implementado.');
  }

  async suggestChart() {
    throw new Error('AccountingAIProvider.suggestChart deve ser implementado.');
  }

  async interpretDocumentImage() {
    throw new Error('AccountingAIProvider.interpretDocumentImage deve ser implementado.');
  }
}

class DisabledAccountingAIProvider extends AccountingAIProvider {
  constructor(reason = 'AI_NOT_CONFIGURED') {
    super('off', null);
    this.reason = reason;
  }

  isConfigured() {
    return false;
  }

  unavailable() {
    const error = new Error('Sugestão inteligente indisponível.');
    error.code = this.reason;
    error.http = 503;
    return error;
  }

  async suggestClassification() {
    throw this.unavailable();
  }

  async suggestChart() {
    throw this.unavailable();
  }

  async interpretDocumentImage() {
    throw this.unavailable();
  }
}

module.exports = { AccountingAIProvider, DisabledAccountingAIProvider };
