'use strict';

const path = require('path');
const { loadConfig } = require('../backend/src/config');
const { createDocumentCrypto } = require('../backend/src/documents/crypto');
const { createDocumentStorage } = require('../backend/src/documents/storage');
const { createDocumentMigrator } = require('../backend/src/documents/migrate');
const { openDatabase } = require('../backend/src/database');

const config = loadConfig(process.env);
const db = openDatabase({
  dbPath: config.CDS_DB_PATH,
  schemaDir: path.join(config.ROOT, 'database', 'schema'),
  uploads: [config.UPLOAD_DIR]
});
const cryptoLayer = createDocumentCrypto({ key: config.DOCUMENT_ENCRYPTION_KEY, kid: config.DOCUMENT_ENCRYPTION_KID });
const storage = createDocumentStorage({ uploadsRoot: config.UPLOAD_DIR, cryptoLayer });
const result = createDocumentMigrator({ db, storage, reportsDir: path.join(config.ROOT, 'logs') }).migrateAll({ encrypt: true });
console.log(JSON.stringify(result, null, 2));
console.log('Relatório de órfãos:', result.orphanPath);
console.log('Nenhum documento órfão foi apagado automaticamente.');
db.close();
