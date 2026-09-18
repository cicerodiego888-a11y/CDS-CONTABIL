'use strict';

const SOURCES = Object.freeze({
  OFFICE: 'OFFICE',
  CLIENT: 'CLIENT',
  IMPORT: 'IMPORT'
});

const ACTION_SOURCES = Object.freeze({
  PORTAL_ESCRITORIO: 'PORTAL_ESCRITORIO',
  PORTAL_CLIENTE: 'PORTAL_CLIENTE'
});

const OFFICE_ROLES = new Set(['OWNER', 'ACCOUNTANT', 'STAFF']);
const IMPORT_ORIGINS = new Set([
  'CDS_SISTEMAS',
  'IMPORTACAO_CONTABIL',
  'IMPORTACAO_FISCAL',
  'OUTRA_ORIGEM_FUTURA'
]);

function actionSource(user) {
  if (!user) return null;
  return user.role === 'CLIENT' ? ACTION_SOURCES.PORTAL_CLIENTE : ACTION_SOURCES.PORTAL_ESCRITORIO;
}

function resolveSource(document) {
  const raw = String(document && document.source || '').trim().toUpperCase();
  if (raw === SOURCES.OFFICE || raw === SOURCES.CLIENT || raw === SOURCES.IMPORT) return raw;
  const origin = String(document && document.origin || '').trim().toUpperCase();
  if (IMPORT_ORIGINS.has(origin)) return SOURCES.IMPORT;
  if (origin === 'PORTAL_ESCRITORIO') return SOURCES.OFFICE;
  const role = String(document && document.uploaded_by_role || '').trim().toUpperCase();
  if (role === 'CLIENT') return SOURCES.CLIENT;
  if (OFFICE_ROLES.has(role)) return SOURCES.OFFICE;
  return null;
}

function sourceLabel(source, action) {
  if (source === SOURCES.OFFICE) return 'Enviado pelo escritório';
  if (source === SOURCES.CLIENT) {
    return action === ACTION_SOURCES.PORTAL_CLIENTE ? 'Enviado por você' : 'Enviado pelo cliente';
  }
  if (source === SOURCES.IMPORT) return 'Importado';
  return 'Origem não definida';
}

function ownershipAllowed(documentSource, action) {
  if (documentSource === SOURCES.OFFICE && action === ACTION_SOURCES.PORTAL_ESCRITORIO) return true;
  if (documentSource === SOURCES.CLIENT && action === ACTION_SOURCES.PORTAL_CLIENTE) return true;
  return false;
}

function ownerForbiddenMessage(documentSource, action) {
  if (action === ACTION_SOURCES.PORTAL_ESCRITORIO && documentSource === SOURCES.CLIENT) {
    return 'Este documento foi enviado pelo cliente e não pode ser excluído pelo escritório.';
  }
  if (action === ACTION_SOURCES.PORTAL_CLIENTE && documentSource === SOURCES.OFFICE) {
    return 'Este documento foi enviado pelo escritório e não pode ser excluído pelo cliente.';
  }
  return 'Este documento não pode ser excluído.';
}

function hasDeletePermission(user, hasClientPermission) {
  if (!user) return false;
  if (OFFICE_ROLES.has(user.role)) return true;
  if (user.role === 'CLIENT') return typeof hasClientPermission === 'function' && !!hasClientPermission('client.documents.delete');
  return false;
}

function canDelete({ user, document, hasClientPermission }) {
  const action = actionSource(user);
  const documentSource = resolveSource(document);
  if (!hasDeletePermission(user, hasClientPermission)) {
    return {
      ok: false,
      code: user && user.role === 'CLIENT' ? 'CLIENT_PERMISSION_REQUIRED' : 'FORBIDDEN',
      message: 'Você não tem permissão para realizar esta operação.',
      documentSource,
      actionSource: action,
      deny: true
    };
  }
  if (!ownershipAllowed(documentSource, action)) {
    return {
      ok: false,
      code: 'DOCUMENT_DELETE_FORBIDDEN_BY_OWNER',
      message: ownerForbiddenMessage(documentSource, action),
      documentSource,
      actionSource: action,
      deny: true
    };
  }
  return { ok: true, documentSource, actionSource: action };
}

function sourceForActor(user) {
  if (user && user.role === 'CLIENT') return SOURCES.CLIENT;
  if (user && OFFICE_ROLES.has(user.role)) return SOURCES.OFFICE;
  return null;
}

function originForActor(user, origens) {
  if (user && user.role === 'CLIENT') return origens.CODES.PORTAL_CLIENTE;
  return origens.CODES.PORTAL_ESCRITORIO;
}

module.exports = {
  SOURCES,
  ACTION_SOURCES,
  resolveSource,
  actionSource,
  sourceLabel,
  ownershipAllowed,
  ownerForbiddenMessage,
  hasDeletePermission,
  canDelete,
  sourceForActor,
  originForActor
};
