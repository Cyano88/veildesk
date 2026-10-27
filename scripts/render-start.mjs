import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {renderConfig} from '../src/render-config.mjs';
process.umask(0o077);
const role=process.argv[2];
if(process.platform!=='linux')throw Error('Render entrypoint requires Linux');
// Fail before opening a database if Render has not attached the required disk.
const mounts=await readFile('/proc/self/mountinfo','utf8');
if(!mounts.split('\n').some(line=>line.split(' ')[4]==='/var/data'))throw Error('Attach a persistent disk at /var/data before starting VeilDesk');
const raw=process.env.VEILDESK_CONFIG_JSON??await readFile(process.env.VEILDESK_CONFIG_FILE||'/etc/secrets/veildesk.json','utf8');
delete process.env.VEILDESK_CONFIG_JSON;
let source;try{source=JSON.parse(raw)}catch{throw Error('Invalid private Render configuration JSON')}
const config=renderConfig(role,source,{relayUrl:process.env.VEILDESK_RELAY_URL});
await mkdir('/var/data',{recursive:true,mode:0o700});
const runtime=await mkdtemp(join(tmpdir(),'veildesk-runtime-')),file=join(runtime,'config.json');await writeFile(file,JSON.stringify(config),{mode:0o600});
if(role==='relay'){
 process.env.VEILDESK_RELAY_CONFIG=file;process.env.VEILDESK_BIND='0.0.0.0';process.env.VEILDESK_BEHIND_TLS_PROXY='true';
 await import('./relay-server.mjs');
}else{process.env.VEILDESK_PROVIDER_CONFIG=file;await import('./provider-worker.mjs')}
