'use strict';

const parser = require('./parser');
const { extractPlanText } = require('./extract');

function previewErrorPayload(err, fileType) {
  const code = err.code || 'PREVIEW_FAILED';
  const stage = err.stage || 'preview';
  const type = err.fileType || fileType || null;
  const user = err.http >= 500
    ? 'Não foi possível processar o arquivo.'
    : (err.message || 'Não foi possível processar o arquivo.');
  return {
    error: err.error || 'PLAN_ACCOUNTS_PREVIEW_INVALID',
    message: user,
    details: {
      stage,
      code,
      reason: err.message || user,
      fileType: type
    }
  };
}

function emptyPreviewError(preview, fileType) {
  if (preview.structure_recognized) {
    return parser.PlanPreviewError(
      'Nenhuma conta foi identificada no arquivo.',
      'NO_ACCOUNTS',
      'parsing',
      fileType
    );
  }
  return parser.PlanPreviewError(
    'Não reconhecemos o formato deste plano de contas.',
    'STRUCTURE_UNRECOGNIZED',
    'detection',
    fileType
  );
}

async function previewPlanFile(file) {
  const ext = require('path').extname(file.originalname || '').toLowerCase();
  const fs = require('fs');
  const buf = fs.readFileSync(file.path);
  const extracted = await extractPlanText(buf, ext || guessExt(file));
  const parsed = parser.parsePlanSource(extracted.text, ext || ('.' + extracted.fileType));
  const preview = parser.buildPreview(parsed);
  preview.file = file.originalname;
  preview.fileType = extracted.fileType;
  if (!preview.valid) throw emptyPreviewError(preview, extracted.fileType);
  return preview;
}

function guessExt(file) {
  const name = String(file.originalname || '').toLowerCase();
  if (name.endsWith('.pdf')) return '.pdf';
  if (name.endsWith('.csv')) return '.csv';
  if (name.endsWith('.txt')) return '.txt';
  const mime = String(file.mimetype || '');
  if (mime.includes('pdf')) return '.pdf';
  if (mime.includes('csv')) return '.csv';
  return '.txt';
}

function importFromPreview(deps, req, preview, name, sourceFile, sourceType) {
  const { id, exec, db, audit } = deps;
  if (!preview.valid) throw parser.PlanPreviewError('Nenhuma conta foi identificada no arquivo.', 'NO_ACCOUNTS', 'import', preview.fileType);
  const plan = id();
  const job = id();
  let imported = 0;
  let ignored = 0;
  const issues = [...(preview.issues || [])];
  const seen = new Set();
  db.transaction(() => {
    exec('INSERT INTO account_plans(id,tenant_id,name,status,source_file) VALUES(?,?,?,?,?)', plan, req.user.tenant_id, name, 'ACTIVE', sourceFile);
    const ins = db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,raw_data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const a of preview.accounts) {
      const code = a.code || a.account_code;
      if (seen.has(code)) {
        ignored++;
        issues.push({ reason: `Código duplicado ignorado: ${code}`, code: 'CODIGO_REPETIDO' });
        continue;
      }
      seen.add(code);
      const type = a.account_type === 'S' ? 'S' : 'A';
      ins.run(
        id(), req.user.tenant_id, plan, code, code, a.classification_code || a.classificacao || code,
        type, a.description || a.descricao, a.parent_code || null, a.level || 0, type === 'A' ? 1 : 0,
        JSON.stringify(a)
      );
      imported++;
    }
    exec(
      'INSERT INTO import_jobs(id,tenant_id,plan_id,source_file,source_type,status,total_rows,imported_rows,rejected_rows,issues_json,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      job, req.user.tenant_id, plan, sourceFile, sourceType, 'COMPLETED',
      preview.total, imported, preview.total - imported, JSON.stringify(issues), req.user.sub
    );
  })();
  if (audit) {
    audit(req, 'ACCOUNT_PLAN_IMPORTED', 'ACCOUNT_PLAN', plan, null, {
      file: sourceFile,
      tenant_id: req.user.tenant_id,
      company_id: req.companyScope || null,
      found: preview.total,
      imported,
      rejected: preview.rejected,
      ignored,
      result: 'COMPLETED'
    });
  }
  return {
    planId: plan,
    jobId: job,
    total: preview.total,
    imported,
    rejected: preview.total - imported,
    ignored,
    existing: ignored,
    issues
  };
}

async function importPlanFile(deps, req, file, name) {
  const path = require('path');
  const fs = require('fs');
  const ext = path.extname(file.originalname).toLowerCase();
  const buf = fs.readFileSync(file.path);
  const extracted = await extractPlanText(buf, ext || guessExt(file));
  const parsed = parser.parsePlanSource(extracted.text, ext || ('.' + extracted.fileType));
  const preview = parser.buildPreview(parsed);
  preview.fileType = extracted.fileType;
  if (!preview.valid) throw emptyPreviewError(preview, extracted.fileType);
  const sourceType = ext === '.pdf' ? 'PDF' : (ext === '.csv' ? 'CSV' : 'TXT');
  return importFromPreview(deps, req, preview, name, file.originalname, sourceType);
}

module.exports = {
  previewPlanFile,
  importPlanFile,
  importFromPreview,
  previewErrorPayload,
  emptyPreviewError
};
