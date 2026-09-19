const {loadConfig}=require('../backend/src/config');
const config=loadConfig(process.env);
if(!config.DEMO_MODE){console.log('Seed CLIENT de demonstração ignorado (DEMO_MODE=false).');process.exit(0)}
const {db}=require('../backend/src/server');
const bcrypt=require('bcryptjs');
const crypto=require('crypto');
const id=()=>crypto.randomUUID();
const email='cliente@cremolia.com.br';
const upsertProfile=db.prepare('INSERT INTO client_user_profiles(user_id,profile,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET profile=excluded.profile,updated_at=CURRENT_TIMESTAMP');
const existing=db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(email);
if(existing){
  upsertProfile.run(existing.id,'CLIENT_ADMIN');
  console.log('Usuário CLIENT já existia; perfil Administrador confirmado: cliente@cremolia.com.br / Client@123');
  process.exit(0);
}
const company=db.prepare('SELECT id,tenant_id FROM companies ORDER BY created_at LIMIT 1').get();
if(!company)throw Error('Execute o seed principal antes do seed CLIENT.');
const userId=id();
db.prepare('INSERT INTO users(id,tenant_id,company_id,name,email,password_hash,role) VALUES(?,?,?,?,?,?,?)').run(userId,company.tenant_id,company.id,'Cliente Demonstração',email,bcrypt.hashSync('Client@123',12),'CLIENT');
upsertProfile.run(userId,'CLIENT_ADMIN');
console.log('Usuário CLIENT criado: cliente@cremolia.com.br / Client@123');
