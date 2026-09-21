const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {db}=require('../backend/src/server');
const parser=require('../backend/src/chart-of-accounts/parser');
const {extractPlanText}=require('../backend/src/chart-of-accounts/extract');
const id=()=>crypto.randomUUID();
(async()=>{
  const file=process.argv[2],tenantId=process.argv[3]||db.prepare('SELECT id FROM tenants ORDER BY created_at LIMIT 1').get()?.id;
  if(!file||!tenantId)throw Error('Uso: node scripts/import-plan-contas.js <arquivo.pdf|csv> [tenantId]');
  const ext=path.extname(file).toLowerCase();
  const extracted=await extractPlanText(fs.readFileSync(file),ext);
  const parsed=parser.parsePlanSource(extracted.text,ext);
  const preview=parser.buildPreview(parsed);
  if(!preview.valid)throw Error('Nenhuma conta foi identificada no arquivo.');
  const seen=new Set();
  const plan=id();
  db.transaction(()=>{
    db.prepare('INSERT INTO account_plans(id,tenant_id,name,status,source_file) VALUES(?,?,?,?,?)').run(plan,tenantId,path.basename(file),'ACTIVE',path.basename(file));
    const ins=db.prepare('INSERT INTO accounts(id,tenant_id,plan_id,source_id,account_code,classification_code,account_type,description,parent_code,level,is_postable,raw_data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    for(const a of preview.accounts){
      if(seen.has(a.code))continue;seen.add(a.code);
      ins.run(id(),tenantId,plan,a.code,a.code,a.classification_code,a.account_type,a.description,a.parent_code,a.level,a.account_type==='A'?1:0,JSON.stringify(a));
    }
  })();
  console.log({planId:plan,rows:preview.total,imported:seen.size,repeated_classifications:preview.repeated_classifications});
})().catch(e=>{console.error(e.message);process.exit(1)});
