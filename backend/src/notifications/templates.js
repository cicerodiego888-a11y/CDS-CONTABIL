'use strict';

const { NOTIFICATION_TYPES } = require('./types');

const BRAND_TITLE = 'CDS Contábil Connect';
const ICON = '/assets/cds-pwa-192.png';
const BADGE = '/assets/cds-push-badge.png';

function moneyLabel(cents) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function safePreview(raw, max = 100) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  // Remover padrões sensíveis óbvios
  s = s
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[doc]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[token]')
    .replace(/\b(sk-|pk_|Bearer\s+)\S+/gi, '[secret]');
  if (s.length > max) s = s.slice(0, max - 1) + '…';
  return s;
}

function companyLabel(name) {
  return String(name || 'Empresa').trim() || 'Empresa';
}

/**
 * Deep-links reais do produto (não inventar rotas).
 * Solicitações já possuem path profundo; demais usam /empresas/{id} + page no data.
 */
function deepLink(type, ctx) {
  const companyId = ctx.company_id;
  const entityId = ctx.entity_id;
  const isClient = !!ctx.for_client;

  switch (type) {
    case NOTIFICATION_TYPES.REQUEST_MESSAGE:
    case NOTIFICATION_TYPES.REQUEST_CREATED:
      if (isClient) {
        return `/portal/?solicitacao=${encodeURIComponent(entityId || '')}`;
      }
      if (companyId && entityId) {
        return `/empresas/${companyId}/solicitacoes/${entityId}`;
      }
      return companyId ? `/empresas/${companyId}` : '/';
    case NOTIFICATION_TYPES.DOCUMENT_RECEIVED:
    case NOTIFICATION_TYPES.DOCUMENT_ANALYSIS_COMPLETED:
    case NOTIFICATION_TYPES.DOCUMENT_ANALYSIS_FAILED:
      if (isClient) {
        return `/portal/?page=documents`;
      }
      return companyId ? `/empresas/${companyId}` : '/';
    case NOTIFICATION_TYPES.EXPENSE_RECEIVED:
    case NOTIFICATION_TYPES.EXPENSE_CREATED:
    case NOTIFICATION_TYPES.EXPENSE_UPDATED:
    case NOTIFICATION_TYPES.REVENUE_RECEIVED:
    case NOTIFICATION_TYPES.REVENUE_CREATED:
      return companyId ? `/empresas/${companyId}` : '/';
    case NOTIFICATION_TYPES.CLASSIFICATION_PENDING:
    case NOTIFICATION_TYPES.CLASSIFICATION_COMPLETED:
    case NOTIFICATION_TYPES.ENTRY_CREATED:
      return companyId ? `/empresas/${companyId}` : '/';
    case NOTIFICATION_TYPES.APPROVAL_PENDING:
    case NOTIFICATION_TYPES.APPROVAL_COMPLETED:
    case NOTIFICATION_TYPES.APPROVAL_REJECTED:
    case NOTIFICATION_TYPES.ENTRY_POSTED:
      return companyId ? `/empresas/${companyId}` : '/';
    case NOTIFICATION_TYPES.PROCESS_CREATED:
    case NOTIFICATION_TYPES.PROCESS_STEP_DUE:
    case NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE:
    case NOTIFICATION_TYPES.PROCESS_COMPLETED:
      return '/';
    case NOTIFICATION_TYPES.INTEGRATION_COMPLETED:
    case NOTIFICATION_TYPES.INTEGRATION_FAILED:
      return companyId ? `/empresas/${companyId}` : '/';
    case NOTIFICATION_TYPES.PENDENCY_CREATED:
    case NOTIFICATION_TYPES.PENDENCY_UPDATED:
      return companyId ? `/empresas/${companyId}` : '/';
    default:
      return isClient ? '/portal/' : (companyId ? `/empresas/${companyId}` : '/');
  }
}

function pageForType(type) {
  const map = {
    [NOTIFICATION_TYPES.REQUEST_MESSAGE]: 'solicitacoes',
    [NOTIFICATION_TYPES.REQUEST_CREATED]: 'solicitacoes',
    [NOTIFICATION_TYPES.DOCUMENT_RECEIVED]: 'documentos',
    [NOTIFICATION_TYPES.DOCUMENT_ANALYSIS_COMPLETED]: 'documentos',
    [NOTIFICATION_TYPES.DOCUMENT_ANALYSIS_FAILED]: 'documentos',
    [NOTIFICATION_TYPES.EXPENSE_RECEIVED]: 'despesas',
    [NOTIFICATION_TYPES.EXPENSE_CREATED]: 'despesas',
    [NOTIFICATION_TYPES.EXPENSE_UPDATED]: 'despesas',
    [NOTIFICATION_TYPES.REVENUE_RECEIVED]: 'despesas',
    [NOTIFICATION_TYPES.REVENUE_CREATED]: 'despesas',
    [NOTIFICATION_TYPES.CLASSIFICATION_PENDING]: 'classificacao',
    [NOTIFICATION_TYPES.CLASSIFICATION_COMPLETED]: 'classificacao',
    [NOTIFICATION_TYPES.ENTRY_CREATED]: 'classificacao',
    [NOTIFICATION_TYPES.APPROVAL_PENDING]: 'aprovacao',
    [NOTIFICATION_TYPES.APPROVAL_COMPLETED]: 'aprovacao',
    [NOTIFICATION_TYPES.APPROVAL_REJECTED]: 'aprovacao',
    [NOTIFICATION_TYPES.ENTRY_POSTED]: 'lancamentos',
    [NOTIFICATION_TYPES.PROCESS_CREATED]: 'processos',
    [NOTIFICATION_TYPES.PROCESS_STEP_DUE]: 'processos',
    [NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE]: 'processos',
    [NOTIFICATION_TYPES.PROCESS_COMPLETED]: 'processos',
    [NOTIFICATION_TYPES.INTEGRATION_COMPLETED]: 'importacoes',
    [NOTIFICATION_TYPES.INTEGRATION_FAILED]: 'importacoes',
    [NOTIFICATION_TYPES.PENDENCY_CREATED]: 'pendencias',
    [NOTIFICATION_TYPES.PENDENCY_UPDATED]: 'pendencias'
  };
  return map[type] || 'dashboard';
}

function tagFor(type, entityId) {
  if (!entityId) return null;
  const prefix = {
    [NOTIFICATION_TYPES.REQUEST_MESSAGE]: 'request',
    [NOTIFICATION_TYPES.REQUEST_CREATED]: 'request',
    [NOTIFICATION_TYPES.DOCUMENT_RECEIVED]: 'document',
    [NOTIFICATION_TYPES.EXPENSE_RECEIVED]: 'expense',
    [NOTIFICATION_TYPES.EXPENSE_CREATED]: 'expense',
    [NOTIFICATION_TYPES.REVENUE_RECEIVED]: 'revenue',
    [NOTIFICATION_TYPES.CLASSIFICATION_PENDING]: 'classification',
    [NOTIFICATION_TYPES.APPROVAL_PENDING]: 'approval',
    [NOTIFICATION_TYPES.APPROVAL_COMPLETED]: 'approval',
    [NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE]: 'process',
    [NOTIFICATION_TYPES.PROCESS_CREATED]: 'process',
    [NOTIFICATION_TYPES.INTEGRATION_COMPLETED]: 'integration',
    [NOTIFICATION_TYPES.INTEGRATION_FAILED]: 'integration',
    [NOTIFICATION_TYPES.PENDENCY_UPDATED]: 'pendency'
  }[type] || 'cds';
  return `${prefix}:${entityId}`;
}

function defaultActions(type) {
  const openTitle = {
    [NOTIFICATION_TYPES.REQUEST_MESSAGE]: 'Abrir conversa',
    [NOTIFICATION_TYPES.REQUEST_CREATED]: 'Abrir solicitação',
    [NOTIFICATION_TYPES.DOCUMENT_RECEIVED]: 'Abrir documento',
    [NOTIFICATION_TYPES.EXPENSE_RECEIVED]: 'Abrir despesa',
    [NOTIFICATION_TYPES.EXPENSE_CREATED]: 'Abrir despesa',
    [NOTIFICATION_TYPES.REVENUE_RECEIVED]: 'Abrir receita',
    [NOTIFICATION_TYPES.CLASSIFICATION_PENDING]: 'Abrir classificação',
    [NOTIFICATION_TYPES.APPROVAL_PENDING]: 'Abrir aprovação',
    [NOTIFICATION_TYPES.APPROVAL_COMPLETED]: 'Abrir',
    [NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE]: 'Abrir processo',
    [NOTIFICATION_TYPES.PROCESS_CREATED]: 'Abrir processo',
    [NOTIFICATION_TYPES.INTEGRATION_COMPLETED]: 'Ver integração',
    [NOTIFICATION_TYPES.INTEGRATION_FAILED]: 'Ver detalhes',
    [NOTIFICATION_TYPES.PENDENCY_UPDATED]: 'Abrir pendência'
  }[type] || 'Abrir';

  const actions = [{ action: 'open', title: openTitle }];
  if (
    type === NOTIFICATION_TYPES.REQUEST_MESSAGE ||
    type === NOTIFICATION_TYPES.REQUEST_CREATED ||
    type === NOTIFICATION_TYPES.DOCUMENT_RECEIVED ||
    type === NOTIFICATION_TYPES.EXPENSE_RECEIVED
  ) {
    actions.push({ action: 'company', title: 'Ir para a empresa' });
  }
  return actions;
}

/**
 * Monta título curto (headline) + corpo multiline + preview.
 * O title da notificação nativa permanece BRAND_TITLE (identidade CDS).
 */
function buildContent(type, input) {
  const company = companyLabel(input.company_name);
  const preview = safePreview(input.preview || input.context || '');
  const amount = input.amount_cents != null ? moneyLabel(input.amount_cents) : null;
  const file = safePreview(input.original_name || '', 80);
  const desc = safePreview(input.description || '', 80);

  let headline = 'Atualização';
  let line2 = company;
  let actionPreview = preview;

  switch (type) {
    case NOTIFICATION_TYPES.REQUEST_MESSAGE: {
      const fromClient = String(input.actor_role || '').toUpperCase() === 'CLIENT';
      headline = 'Nova mensagem';
      line2 = fromClient
        ? `${company} respondeu à solicitação.`
        : `${company}\nO escritório respondeu à solicitação.`;
      actionPreview = preview || safePreview(input.title || 'solicitação', 80);
      break;
    }
    case NOTIFICATION_TYPES.REQUEST_CREATED:
      headline = 'Nova solicitação';
      line2 = fromOfficeLine(company, 'enviou uma solicitação.');
      actionPreview = preview || safePreview(input.title || '', 80);
      break;
    case NOTIFICATION_TYPES.DOCUMENT_RECEIVED: {
      const fromOfficeToClient = !!input.for_client
        || (input.actor_role && String(input.actor_role).toUpperCase() !== 'CLIENT');
      if (fromOfficeToClient) {
        headline = 'Novo documento';
        line2 = 'O escritório enviou um documento para você.';
        actionPreview = file || preview;
      } else {
        headline = 'Novo documento recebido';
        line2 = `${company}\nenviou um documento para análise.`;
        actionPreview = file || preview;
      }
      break;
    }
    case NOTIFICATION_TYPES.EXPENSE_RECEIVED:
    case NOTIFICATION_TYPES.EXPENSE_CREATED:
      headline = 'Nova despesa recebida';
      line2 = company;
      actionPreview = [amount, desc || preview].filter(Boolean).join(' — ') || preview;
      break;
    case NOTIFICATION_TYPES.REVENUE_RECEIVED:
    case NOTIFICATION_TYPES.REVENUE_CREATED:
      headline = 'Nova receita recebida';
      line2 = company;
      actionPreview = [amount, desc || preview].filter(Boolean).join(' — ') || preview;
      break;
    case NOTIFICATION_TYPES.CLASSIFICATION_PENDING:
      headline = 'Classificação pendente';
      line2 = input.count
        ? `${input.count} documentos aguardam classificação.`
        : `${company} possui movimentação aguardando classificação.`;
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.CLASSIFICATION_COMPLETED:
      headline = 'Classificação concluída';
      line2 = `Uma movimentação de ${company} foi classificada.`;
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.APPROVAL_PENDING:
      headline = 'Aprovação pendente';
      line2 = 'Uma despesa aguarda sua aprovação.';
      actionPreview = [amount, desc || preview].filter(Boolean).join(' — ') || preview;
      break;
    case NOTIFICATION_TYPES.APPROVAL_COMPLETED:
      headline = 'Aprovação concluída';
      line2 = `Uma classificação de ${company} foi aprovada.`;
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.APPROVAL_REJECTED:
      headline = 'Aprovação rejeitada';
      line2 = `Uma classificação de ${company} foi rejeitada.`;
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.ENTRY_CREATED:
      headline = 'Lançamento gerado';
      line2 = `Novo lançamento de ${company}`;
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.ENTRY_POSTED:
      headline = 'Lançamento efetivado';
      line2 = `Um lançamento de ${company} foi gerado após a aprovação`;
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.PROCESS_CREATED:
      headline = 'Novo processo';
      line2 = safePreview(input.process_name || input.title || company, 80);
      actionPreview = preview;
      break;
    case NOTIFICATION_TYPES.PROCESS_STEP_DUE:
      headline = 'Atividade pendente';
      line2 = safePreview(input.process_name || input.title || company, 80);
      actionPreview = 'Uma atividade está próxima do prazo.';
      break;
    case NOTIFICATION_TYPES.PROCESS_STEP_OVERDUE:
      headline = 'Atividade atrasada';
      line2 = safePreview(input.process_name || input.title || company, 80);
      actionPreview = safePreview(input.step_name || 'Uma etapa está atrasada.', 80);
      break;
    case NOTIFICATION_TYPES.PROCESS_COMPLETED:
      headline = 'Processo concluído';
      line2 = safePreview(input.process_name || input.title || company, 80);
      actionPreview = preview;
      break;
    case NOTIFICATION_TYPES.INTEGRATION_COMPLETED:
      headline = 'Integração concluída';
      line2 = 'A importação foi processada com sucesso.';
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.INTEGRATION_FAILED:
      headline = 'Falha na integração';
      line2 = 'Foi encontrada uma falha durante o processamento.';
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.PENDENCY_UPDATED:
      headline = 'Resposta de pendência';
      line2 = `${company} respondeu uma pendência.`;
      actionPreview = preview || desc;
      break;
    case NOTIFICATION_TYPES.PUSH_TEST:
      headline = 'Nova mensagem';
      line2 = 'Notificação de teste do CDS Contábil Connect.';
      actionPreview = '';
      break;
    default:
      headline = input.title || 'Atualização';
      line2 = input.body || company;
      actionPreview = preview;
  }

  const bodyParts = [headline, line2];
  if (actionPreview) bodyParts.push(`"${actionPreview}"`);
  const body = bodyParts.join('\n').slice(0, 220);

  return {
    brand_title: BRAND_TITLE,
    headline,
    body,
    preview: actionPreview,
    in_app_title: headline,
    in_app_message: line2.replace(/\n/g, ' '),
    in_app_context: actionPreview || null
  };
}

function fromOfficeLine(company, rest) {
  return `${company}\n${rest}`;
}

function buildPushPayload(type, input) {
  const content = buildContent(type, input);
  const forClient = !!input.for_client;
  const url = input.url || deepLink(type, {
    company_id: input.company_id,
    entity_id: input.entity_id,
    for_client: forClient
  });
  const page = input.page || pageForType(type);
  return {
    type,
    title: BRAND_TITLE,
    body: content.body,
    preview: content.preview || null,
    icon: ICON,
    badge: BADGE,
    tag: input.tag || tagFor(type, input.entity_id),
    actions: Array.isArray(input.actions) ? input.actions.slice(0, 2) : defaultActions(type),
    url,
    tenant_id: input.tenant_id || null,
    company_id: input.company_id || null,
    entity_type: input.entity_type || null,
    entity_id: input.entity_id || null,
    request_id: type.startsWith('REQUEST') ? (input.entity_id || input.request_id || null) : (input.request_id || null),
    message_id: input.message_id || null,
    page,
    data: {
      tenant_id: input.tenant_id || null,
      company_id: input.company_id || null,
      entity_type: input.entity_type || null,
      entity_id: input.entity_id || null,
      url,
      page,
      type
    }
  };
}

module.exports = {
  BRAND_TITLE,
  ICON,
  BADGE,
  safePreview,
  moneyLabel,
  deepLink,
  pageForType,
  tagFor,
  defaultActions,
  buildContent,
  buildPushPayload
};
