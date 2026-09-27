'use strict';
const Database = require('better-sqlite3');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const dbPath = env.match(/^CDS_DB_PATH=(.+)$/m)[1].trim().replace(/^["']|["']$/g, '');
const db = new Database(dbPath, { readonly: true });

const docId = 'e018e369-4a79-4587-ac2e-29d027f7d859';
const run = db.prepare('SELECT * FROM document_pipeline_runs WHERE document_id=?').get(docId);
console.log('run status', run && run.status, run && run.error_code, run && run.error_message);
console.log('suggestion', run && run.suggestion_json && JSON.parse(run.suggestion_json));
console.log('fields sample', run && run.fields_json && Object.fromEntries(Object.entries(JSON.parse(run.fields_json)).map(([k,v])=>[k, v && v.value])));

console.log('\n=== ACCOUNTS postable sample ===');
console.log(db.prepare(`SELECT account_code,description,is_postable,active FROM accounts WHERE tenant_id=? AND is_postable=1 AND active=1 LIMIT 15`).all('33c265c1-bb77-455b-9228-e273eb769238'));

console.log('\n=== AI SUGGESTIONS for doc ===');
console.log(db.prepare(`SELECT id,status,operation_type,primary_account_id,confidence,substr(reason,1,100) reason FROM ai_classification_suggestions WHERE document_id=?`).all(docId));

console.log('\n=== RULES ===');
console.log(db.prepare(`SELECT COUNT(*) n FROM accounting_rules WHERE tenant_id=?`).get('33c265c1-bb77-455b-9228-e273eb769238'));

console.log('\n=== CATEGORIES with account ===');
console.log(db.prepare(`SELECT name,account_id FROM categories WHERE tenant_id=? AND active=1 LIMIT 10`).all('33c265c1-bb77-455b-9228-e273eb769238'));

console.log('\n=== BANKS with account ===');
console.log(db.prepare(`SELECT name,account_id FROM banks WHERE tenant_id=? AND active=1 LIMIT 10`).all('33c265c1-bb77-455b-9228-e273eb769238'));
