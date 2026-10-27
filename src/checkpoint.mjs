import {readdir,lstat,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,join,isAbsolute,sep} from 'node:path';
import {randomBytes,scryptSync,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
const LIMIT=64*1024*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
function key(password,salt){if(typeof password!=='string'||password.length<16)throw Error('Checkpoint password must contain at least 16 characters');return scryptSync(password,salt,32)}
function inside(root,path){const rel=relative(root,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep)}
async function capture(root){
 const files=[];let bytes=0;
 async function walk(dir){for(const name of (await readdir(dir)).sort()){
  const path=join(dir,name),stat=await lstat(path);
  if(stat.isSymbolicLink())throw Error('Checkpoint refuses symbolic links');
  if(stat.isDirectory()){await walk(path);continue}
  if(!stat.isFile())throw Error('Unsupported checkpoint file');
  if(/-wal$/.test(name)&&stat.size)throw Error('Stop services cleanly and checkpoint SQLite WAL before backup');
  bytes+=stat.size;if(bytes>LIMIT)throw Error('Checkpoint exceeds 64 MiB limit');
  const data=await readFile(path);files.push({path:relative(root,path).split(sep).join('/'),data:data.toString('base64'),sha256:hash(data)});
 }}await walk(root);return files;
}
function validatePath(path){if(typeof path!=='string'||!path||path.includes('\\')||path.includes(':')||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid checkpoint path')}
function relocate(files,oldRoot,newRoot){
 return files.map(file=>{
  validatePath(file.path);const data=Buffer.from(file.data,'base64');if(hash(data)!==file.sha256)throw Error('Checkpoint content checksum mismatch');
  if(!/(^|\/)(relay|provider)\.json$/.test(file.path))return {...file,bytes:data};
  const config=JSON.parse(data.toString('utf8'));
  for(const field of ['database','stateDirectory'])if(config[field]!==undefined){
   if(typeof config[field]!=='string'||!isAbsolute(config[field])||!inside(oldRoot,resolve(config[field])))throw Error('Configuration references state outside checkpoint root');
   config[field]=join(newRoot,relative(oldRoot,resolve(config[field])));
  }
  return {...file,bytes:Buffer.from(JSON.stringify(config,null,2)+'\n')};
 });
}
export async function createCheckpoint({directory,file,password,servicesStopped=false}){
 if(servicesStopped!==true)throw Error('Stop relay, provider and client writers before checkpoint');
 const root=resolve(directory),target=resolve(file);if(inside(root,target)||root===target)throw Error('Checkpoint output must be outside source directory');
 if((await lstat(root)).isSymbolicLink())throw Error('Checkpoint refuses symbolic links');
 const files=await capture(root);if(!files.length)throw Error('Empty checkpoint');
 relocate(files,root,root); // Validate managed configuration paths before packaging secrets.
 if(JSON.stringify(files)!==JSON.stringify(await capture(root)))throw Error('State changed during checkpoint');
 const payload=Buffer.from(JSON.stringify({schema:'veildesk.offline-checkpoint.v1',root,createdAt:new Date().toISOString(),files}));
 const salt=randomBytes(16),iv=randomBytes(12),secret=key(password,salt);
 try{
  const cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(Buffer.from('veildesk.checkpoint.v1'));
  const ciphertext=Buffer.concat([cipher.update(payload),cipher.final()]);
  await writeFile(target,JSON.stringify({schema:'veildesk.checkpoint.v1',salt:salt.toString('hex'),iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('base64')}),{mode:0o600,flag:'wx'});
 }finally{secret.fill(0)}
 return {files:files.length,encrypted:true,walletRecoveryVerified:false,requiresReconciliation:true};
}
export async function restoreCheckpoint({file,directory,password}){
 const stat=await lstat(file);if(stat.size>LIMIT*2)throw Error('Checkpoint too large');
 const envelope=JSON.parse(await readFile(file,'utf8'));
 if(envelope.schema!=='veildesk.checkpoint.v1'||!/^[0-9a-f]{32}$/.test(envelope.salt)||!/^[0-9a-f]{24}$/.test(envelope.iv)||!/^[0-9a-f]{32}$/.test(envelope.tag)||typeof envelope.ciphertext!=='string')throw Error('Invalid checkpoint envelope');
 const secret=key(password,Buffer.from(envelope.salt,'hex'));let payload;
 try{
  const decipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(envelope.iv,'hex'));decipher.setAAD(Buffer.from(envelope.schema));decipher.setAuthTag(Buffer.from(envelope.tag,'hex'));
  payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8'));
 }catch{throw Error('Checkpoint authentication failed')}finally{secret.fill(0)}
 if(payload.schema!=='veildesk.offline-checkpoint.v1'||!isAbsolute(payload.root)||!Array.isArray(payload.files)||!payload.files.length)throw Error('Invalid checkpoint payload');
 const target=resolve(directory),files=relocate(payload.files,payload.root,target),paths=new Set();
 for(const f of files){const p=resolve(target,f.path);if(!inside(target,p)||paths.has(p.toLowerCase()))throw Error('Duplicate or unsafe checkpoint path');paths.add(p.toLowerCase())}
 await mkdir(target,{mode:0o700});
 for(const f of files){const p=join(target,f.path);await mkdir(resolve(p,'..'),{recursive:true,mode:0o700});await writeFile(p,f.bytes,{mode:0o600,flag:'wx'})}
 return {files:files.length,restored:true,automaticResume:false,requiresReconciliation:true};
}

