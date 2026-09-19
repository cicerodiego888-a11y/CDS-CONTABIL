'use strict';

const path = require('path');
const { loadConfig } = require('../backend/src/config');
const { openDatabase } = require('../backend/src/database');

const config = loadConfig(process.env);
const db = openDatabase({
  dbPath: config.CDS_DB_PATH,
  schemaDir: path.join(config.ROOT, 'database', 'schema'),
  uploads: [config.UPLOAD_DIR]
});

const integrity = db.prepare('PRAGMA integrity_check').all();
const fk = db.prepare('PRAGMA foreign_key_check').all();
console.log('integrity_check', integrity);
console.log('foreign_key_check', fk.length ? fk : 'ok');
db.close();
if (!integrity.length || integrity[0].integrity_check !== 'ok' || fk.length) process.exit(2);
