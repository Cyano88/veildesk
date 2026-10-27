import {DatabaseSync} from 'node:sqlite';
import {createHash,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
const digest=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(x);
function fail(status,message){throw Object.assign(Error(message),{status})}
export function validateRelayEnvelope(e,id,direction){
 const fields=['version','id','direction','ephemeralPublicKey','salt','iv','ciphertext'];
 if(!e||Object.keys(e).length!==7||Object.keys(e).some(k=>!fields.includes(k))||e.version!==1||e.id!==id||!uuid(id)||e.direction!==direction)fail(400,'Invalid encrypted envelope');
 for(const [key,length] of Object.entries({ephemeralPublicKey:65,salt:32,iv:12,ciphertext:4112})){
  if(typeof e[key]!=='string'||e[key].length>6000)fail(400,'Invalid encrypted envelope');
  const b=Buffer.from(e[key],'base64');if(b.length!==length||b.toString('base64')!==e[key]||(key==='ephemeralPublicKey'&&b[0]!==4))fail(400,'Invalid encrypted envelope');
 }
}
// Opaque relay: application payloads are authenticated/decrypted only at endpoints.
// Configure one SQLite file on a persistent local volume, not a network filesystem.
export function createRelay({database,principals,providers,now=Date.now,maxPending=1000,maxRecords=100000,maxRequestsPerMinute=600,bodyTimeoutMs=10000}){
 if(!Array.isArray(principals)||!principals.length||!Array.isArray(providers))throw Error('Missing relay configuration');
 for(const n of [maxPending,maxRecords,maxRequestsPerMinute])if(!Number.isSafeInteger(n)||n<1)throw Error('Invalid resource limit');
 if(!Number.isSafeInteger(bodyTimeoutMs)||bodyTimeoutMs<100||bodyTimeoutMs>15000)throw Error('Invalid body timeout');
 const ids=new Set(),tokens=new Set();
 for(const p of principals){
  if(!/^[a-z0-9-]{1,64}$/.test(p.id)||ids.has(p.id)||!['client','provider'].includes(p.role)||!/^[a-f0-9]{64}$/.test(p.tokenHash)||tokens.has(p.tokenHash))throw Error('Invalid principal configuration');
  ids.add(p.id);tokens.add(p.tokenHash);
 }
 for(const p of providers)if(!principals.some(x=>x.role==='provider'&&x.id===p.id)||!Array.isArray(p.capabilities)||typeof p.encryptionKey!=='string'||typeof p.signingKey!=='string')throw Error('Invalid provider configuration');
 if(new Set(providers.map(p=>p.id)).size!==providers.length)throw Error('Duplicate provider');
 for(const p of providers)if(p.allowedClients!==undefined&&(!Array.isArray(p.allowedClients)||!p.allowedClients.length||new Set(p.allowedClients).size!==p.allowedClients.length||p.allowedClients.some(id=>!principals.some(x=>x.id===id&&x.role==='client'))))throw Error('Invalid private provider enrollment');
 providers=providers.map(p=>({id:p.id,encryptionKey:p.encryptionKey,signingKey:p.signingKey,capabilities:[...p.capabilities],...(p.allowedClients?{allowedClients:[...p.allowedClients]}:{})}));
 const usage=new Map();
 const db=new DatabaseSync(database);db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS relay_jobs(client TEXT NOT NULL,id TEXT NOT NULL,provider TEXT NOT NULL,capability TEXT NOT NULL,request TEXT NOT NULL,request_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('queued','processing','completed','expired')),created INTEGER NOT NULL,expires INTEGER NOT NULL,response TEXT,PRIMARY KEY(client,id));
 CREATE INDEX IF NOT EXISTS relay_provider_queue ON relay_jobs(provider,state,created);`);
 // Additive migration: existing unpaid jobs and immutable results are preserved.
 const columns=new Set(db.prepare('PRAGMA table_info(relay_jobs)').all().map(c=>c.name));
 for(const column of ['invoice','payment_hint','payment_review'])if(!columns.has(column))db.exec(`ALTER TABLE relay_jobs ADD COLUMN ${column} TEXT`);
 function auth(req){
  const header=req.headers.authorization;if(typeof header!=='string'||!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(header))fail(401,'Unauthorized');
  const hash=Buffer.from(digest(header.slice(7)),'hex');const p=principals.find(x=>timingSafeEqual(hash,Buffer.from(x.tokenHash,'hex')));if(!p)fail(401,'Unauthorized');return p;
 }
 const describe=row=>({id:row.id,provider:row.provider,capability:row.capability,state:row.state,createdAt:row.created,expiresAt:row.expires,late:now()>=row.expires,executionAuthorized:false,...(row.invoice?{invoiceEnvelope:JSON.parse(row.invoice)}:{}),...(row.payment_review?{paymentReviewEnvelope:JSON.parse(row.payment_review)}:{}),...(row.response?{envelope:JSON.parse(row.response)}:{})});
 function expire(){db.prepare("UPDATE relay_jobs SET state='expired' WHERE state='queued' AND expires<=?").run(now())}
 function body(req){return new Promise((resolve,reject)=>{
  let size=0,chunks=[],settled=false;
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('aborted',abort);req.off('error',abort);req.once('error',()=>{});if(error){req.pause();reject(error)}else resolve(value)}
  const error=(status,message)=>Object.assign(Error(message),{status});
  function data(chunk){size+=chunk.length;if(size>16384)return finish(error(413,'Request too large'));chunks.push(chunk)}
  function end(){try{finish(null,JSON.parse(Buffer.concat(chunks).toString()))}catch{finish(error(400,'Invalid JSON'))}}
  function abort(){finish(error(400,'Request interrupted'))}
  const timer=setTimeout(()=>finish(error(408,'Request body timed out')),bodyTimeoutMs);timer.unref();
  req.on('data',data);req.once('end',end);req.once('aborted',abort);req.once('error',abort);
  if(Number(req.headers['content-length'])>16384)finish(error(413,'Request too large'));
 })}
 function exact(b,fields){if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==fields.length||Object.keys(b).some(k=>!fields.includes(k)))fail(400,'Invalid request fields')}
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
  let status=200,result;
  try{
   if(req.url==='/healthz'&&req.method==='GET'){db.prepare('SELECT 1').get();result={status:'ok'}}
   else {
    const principal=auth(req);expire();
    const minute=Math.floor(now()/60000),window=usage.get(principal.id);
    if(!window||window.minute!==minute)usage.set(principal.id,{minute,count:1});
    else if(++window.count>maxRequestsPerMinute){res.setHeader('Retry-After','60');fail(429,'Request rate exceeded')}
    if(req.url==='/v1/providers'&&req.method==='GET')result={schema:'veildesk.providers.v1',providers:providers.filter(p=>!p.allowedClients||p.allowedClients.includes(principal.id)||p.id===principal.id).map(({allowedClients,...descriptor})=>descriptor)};
    else if(req.url==='/v1/jobs'&&req.method==='POST'){
     if(principal.role!=='client')fail(403,'Forbidden');const b=await body(req);exact(b,['id','provider','capability','expiresAt','envelope']);validateRelayEnvelope(b.envelope,b.id,'request');
     const provider=providers.find(x=>x.id===b.provider);if(!provider||!provider.capabilities.includes(b.capability))fail(400,'Unsupported provider capability');if(provider.allowedClients&&!provider.allowedClients.includes(principal.id))fail(403,'Provider is privately enrolled');
     const e=b.envelope;
     const request=JSON.stringify({id:b.id,provider:b.provider,capability:b.capability,expiresAt:b.expiresAt,envelope:{version:e.version,id:e.id,direction:e.direction,ephemeralPublicKey:e.ephemeralPublicKey,salt:e.salt,iv:e.iv,ciphertext:e.ciphertext}}),hash=digest(request);const prior=db.prepare('SELECT * FROM relay_jobs WHERE client=? AND id=?').get(principal.id,b.id);
     if(prior){if(prior.request_hash!==hash)fail(409,'Job ID conflict');result=describe(prior)}
     else{
      if(!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=now()||b.expiresAt>now()+3600000)fail(400,'Invalid expiry');
      if(db.prepare('SELECT COUNT(*) AS n FROM relay_jobs').get().n>=maxRecords)fail(503,'Job storage capacity reached');
      const pending=db.prepare("SELECT COUNT(*) AS n FROM relay_jobs WHERE client=? AND state IN ('queued','processing')").get(principal.id).n;if(pending>=maxPending)fail(429,'Pending job quota reached');
      db.prepare("INSERT INTO relay_jobs(client,id,provider,capability,request,request_hash,state,created,expires) VALUES(?,?,?,?,?,?,'queued',?,?)").run(principal.id,b.id,b.provider,b.capability,request,hash,now(),b.expiresAt);
      status=201;result=describe(db.prepare('SELECT * FROM relay_jobs WHERE client=? AND id=?').get(principal.id,b.id));
     }
    }else if(req.url==='/v1/provider/claim'&&req.method==='POST'){
     if(principal.role!=='provider')fail(403,'Forbidden');exact(await body(req),[]);
     const row=db.prepare("UPDATE relay_jobs SET state='processing' WHERE rowid=(SELECT rowid FROM relay_jobs WHERE provider=? AND state='queued' ORDER BY created LIMIT 1) RETURNING *").get(principal.id);
     result={job:row?{...describe(row),client:row.client,envelope:JSON.parse(row.request).envelope}:null};
    }else if((req.url==='/v1/provider/pending'||req.url.startsWith('/v1/provider/pending?'))&&req.method==='GET'){
     if(principal.role!=='provider')fail(403,'Forbidden');
     const query=new URL(req.url,'http://localhost').searchParams;
     if([...query.keys()].some(k=>!['limit','after'].includes(k))||query.getAll('limit').length>1||query.getAll('after').length>1)fail(400,'Invalid pending query');
     const limitText=query.get('limit')??'100',limit=Number(limitText);if(!/^[1-9][0-9]{0,2}$/.test(limitText)||limit>100)fail(400,'Invalid pending limit');
     let after=['',''];const cursor=query.get('after');
     if(cursor!==null){try{if(cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();after=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(!Array.isArray(after)||after.length!==2||typeof after[0]!=='string'||!/^[a-z0-9-]{1,64}$/.test(after[0])||!uuid(after[1]))throw Error()}catch{fail(400,'Invalid pending cursor')}}
     const rows=db.prepare("SELECT * FROM relay_jobs WHERE provider=? AND state='processing' AND (client,id)>(?,?) ORDER BY client,id LIMIT ?").all(principal.id,...after,limit);
     const last=rows.at(-1);result={jobs:rows.map(row=>({...describe(row),client:row.client,envelope:JSON.parse(row.request).envelope,...(row.payment_hint?{paymentHint:JSON.parse(row.payment_hint)}:{})})),nextCursor:rows.length===limit?Buffer.from(JSON.stringify([last.client,last.id])).toString('base64url'):null};
    }else if(req.url==='/v1/provider/payment-review'&&req.method==='POST'){
     if(principal.role!=='provider')fail(403,'Forbidden');const b=await body(req);exact(b,['client','id','envelope']);validateRelayEnvelope(b.envelope,b.id,'response');
     const row=db.prepare('SELECT * FROM relay_jobs WHERE client=? AND id=? AND provider=?').get(b.client,b.id,principal.id);if(!row)fail(404,'Job not found');
     if(row.capability!=='prediction.mandate.validate.testnet-paid.v1'||row.state!=='processing')fail(409,'Job cannot enter payment review');
     const value=JSON.stringify(b.envelope);if(row.payment_review&&row.payment_review!==value)fail(409,'Payment review conflict');
     if(!row.payment_review)db.prepare('UPDATE relay_jobs SET payment_review=? WHERE client=? AND id=?').run(value,b.client,b.id);
     result={id:b.id,state:'payment_review',executionAuthorized:false};
    }else if(req.url==='/v1/provider/invoice'&&req.method==='POST'){
     if(principal.role!=='provider')fail(403,'Forbidden');const b=await body(req);exact(b,['client','id','envelope']);validateRelayEnvelope(b.envelope,b.id,'response');
     const row=db.prepare('SELECT * FROM relay_jobs WHERE client=? AND id=? AND provider=?').get(b.client,b.id,principal.id);if(!row)fail(404,'Job not found');
     if(row.capability!=='prediction.mandate.validate.testnet-paid.v1'||!['processing','completed'].includes(row.state))fail(409,'Job is not awaiting a testnet invoice');
     const value=JSON.stringify(b.envelope);if(row.invoice&&row.invoice!==value)fail(409,'Invoice conflict');
     if(!row.invoice){if(row.state!=='processing'||now()>=row.expires)fail(409,'Job expired or completed');db.prepare('UPDATE relay_jobs SET invoice=? WHERE client=? AND id=?').run(value,b.client,b.id)}
     result={id:b.id,state:'invoice_issued',executionAuthorized:false};
    }else if(req.method==='POST'&&/^\/v1\/jobs\/[a-f0-9-]+\/payment$/.test(req.url)){
     if(principal.role!=='client')fail(403,'Forbidden');const id=req.url.split('/')[3],b=await body(req);exact(b,['envelope']);validateRelayEnvelope(b.envelope,id,'request');
     const row=db.prepare('SELECT * FROM relay_jobs WHERE client=? AND id=?').get(principal.id,id);if(!row)fail(404,'Job not found');
     if(!row.invoice||row.state!=='processing'||row.capability!=='prediction.mandate.validate.testnet-paid.v1')fail(409,'No pending testnet invoice');
     const value=JSON.stringify(b.envelope);if(row.payment_hint&&row.payment_hint!==value)fail(409,'Payment hint conflict');
     if(!row.payment_hint)db.prepare('UPDATE relay_jobs SET payment_hint=? WHERE client=? AND id=?').run(value,principal.id,id);
     result={id,state:'evidence_submitted',executionAuthorized:false};
    }else if(req.url==='/v1/provider/deliver'&&req.method==='POST'){
     if(principal.role!=='provider')fail(403,'Forbidden');const b=await body(req);exact(b,['client','id','envelope']);validateRelayEnvelope(b.envelope,b.id,'response');
     const row=db.prepare('SELECT * FROM relay_jobs WHERE client=? AND id=? AND provider=?').get(b.client,b.id,principal.id);if(!row)fail(404,'Job not found');
     if(row.payment_review)fail(409,'Payment requires review');
     const response=JSON.stringify(b.envelope);
     if(row.state==='completed'){if(row.response!==response)fail(409,'Delivery conflict')}
     else{if(row.state!=='processing')fail(409,'Job not claimed');db.prepare("UPDATE relay_jobs SET state='completed',response=? WHERE client=? AND id=?").run(response,b.client,b.id)}
     result={id:b.id,state:'completed',late:now()>=row.expires,executionAuthorized:false};
    }else if(req.method==='GET'&&/^\/v1\/jobs\/[a-f0-9-]+$/.test(req.url)){
     if(principal.role!=='client')fail(403,'Forbidden');const id=req.url.slice('/v1/jobs/'.length);if(!uuid(id))fail(400,'Invalid ID');
     const row=db.prepare('SELECT * FROM relay_jobs WHERE client=? AND id=?').get(principal.id,id);if(!row)fail(404,'Job not found');result=describe(row);
    }else fail(404,'Not found');
   }
  }catch(error){status=error.status||500;result={error:error.status?error.message:'Service unavailable'}}
  if(res.destroyed)return;
  if(status>=400&&!req.complete)res.setHeader('Connection','close');
  res.writeHead(status);res.end(JSON.stringify(result));
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 return {server,close:async()=>{
  const force=setTimeout(()=>server.closeAllConnections(),5000);force.unref();
  try{await new Promise(resolve=>server.close(resolve))}finally{clearTimeout(force);db.close()}
 }};
}


