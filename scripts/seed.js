'use strict';

const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { loadConfig } = require('../backend/src/config');
const config = loadConfig(process.env);

if (!config.DEMO_MODE) {
  console.log('Seed de demonstração ignorado (DEMO_MODE=false).');
  process.exit(0);
}

const { db } = require('../backend/src/server');
const id = () => crypto.randomUUID();

const tenant = db.prepare("SELECT * FROM tenants WHERE slug='escritorio-demonstracao'").get()
  || db.prepare("SELECT * FROM tenants WHERE lower(name) LIKE '%demonstr%'").get();

let tenantId = tenant && tenant.id;
if (!tenantId) {
  tenantId = id();
  db.prepare('INSERT INTO tenants(id,name,slug) VALUES(?,?,?)').run(tenantId, 'Escritório Demonstração', 'escritorio-demonstracao');
} else if (!tenant.slug) {
  db.prepare("UPDATE tenants SET slug='escritorio-demonstracao' WHERE id=?").run(tenantId);
}

const email = 'admin@demo.local';
let owner = db.prepare('SELECT * FROM users WHERE tenant_id=? AND lower(email)=?').get(tenantId, email);
if (!owner) {
  const uid = id();
  db.prepare('INSERT INTO users(id,tenant_id,name,email,password_hash,role,active) VALUES(?,?,?,?,?,?,1)')
    .run(uid, tenantId, 'Administrador Demo', email, bcrypt.hashSync('Admin@123', 12), 'OWNER');
  owner = { id: uid };
}

let company = db.prepare('SELECT * FROM companies WHERE tenant_id=? ORDER BY created_at LIMIT 1').get(tenantId);
if (!company) {
  const cid = id();
  db.prepare('INSERT INTO companies(id,tenant_id,name,trade_name,status) VALUES(?,?,?,?,?)')
    .run(cid, tenantId, 'Empresa Demonstração Ltda', 'Demo', 'ACTIVE');
}

console.log('Ambiente DEMO pronto.');
console.log('Escritório: escritorio-demonstracao / admin@demo.local / Admin@123');
console.log('Estas credenciais existem somente com DEMO_MODE=true.');
