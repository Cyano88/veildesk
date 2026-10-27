import {spawn} from 'node:child_process';import {once} from 'node:events';import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),poly=process.env.POLYDESK_ROOT||resolve(root,'../polydesk');
const hash=b=>createHash('sha256').update(b).digest('hex'),files=[];
async function walk(dir){for(const item of await readdir(join(root,dir),{withFileTypes:true})){const path=dir+'/'+item.name;if(item.isDirectory())await walk(path);else files.push({path,sha256:hash(await readFile(join(root,path)))})}}
for(const dir of ['src','scripts','tests','ops','examples'])await walk(dir);
for(const path of ['package.json','Dockerfile','.dockerignore','render.yaml'])files.push({path,sha256:hash(await readFile(join(root,path)))});
for(const path of ['api/veildesk-client.ts','scripts/veildesk-client.ts'])files.push({path:'polydesk/'+path,sha256:hash(await readFile(join(poly,path)))});
files.sort((a,b)=>a.path.localeCompare(b.path));
const args=['--test',...(await readdir(join(root,'tests'))).filter(x=>x.endsWith('.test.mjs')).sort().map(x=>'tests/'+x)];
const startedAt=new Date().toISOString(),child=spawn(process.execPath,args,{cwd:root,env:{...process.env,POLYDESK_ROOT:poly},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
const timeout=setTimeout(()=>child.kill(),120000);let exitCode;try{[exitCode]=await once(child,'exit')}finally{clearTimeout(timeout)}
const report={schema:'veildesk.acceptance.v1',startedAt,finishedAt:new Date().toISOString(),runtime:process.version,platform:process.platform,codeSha256:hash(JSON.stringify(files)),files,command:['node',...args],exitCode,passed:exitCode===0,scope:'Local real HTTP and separate-process tests plus explicitly synthetic Zcash fixtures; not deployed or on-chain acceptance.',paymentVerified:false,deploymentVerified:false,marketplaceListed:false,stdout,stderr};
await mkdir(join(root,'output'),{recursive:true});const output=join(root,'output','acceptance-'+startedAt.replace(/[:.]/g,'-')+'.json');await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(stdout);console.log('Evidence: '+output);if(exitCode!==0)process.exitCode=1;


