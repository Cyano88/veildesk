// Run the wire interoperability test against PolyDesk's real engine with offline inputs.
import {spawn} from 'node:child_process';import {once} from 'node:events';import {access} from 'node:fs/promises';import {resolve,join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!process.env.POLYDESK_ROOT)throw Error('Set POLYDESK_ROOT to the PolyDesk checkout with dependencies installed');
const poly=resolve(process.env.POLYDESK_ROOT),adapter=join(poly,'api/veildesk-research-service.mjs'),engine=join(poly,'scripts/veildesk-engine-fixture.ts'),loader=join(poly,'node_modules/tsx/dist/loader.mjs');
await Promise.all([adapter,engine,loader].map(file=>access(file)));
const child=spawn(process.execPath,['--import',pathToFileURL(loader).href,'--test','tests/encrypted-http.test.mjs'],{cwd:root,stdio:'inherit',env:{...process.env,VEILDESK_POLYDESK_ADAPTER:adapter,VEILDESK_POLYDESK_ENGINE_FIXTURE:engine}});
const timer=setTimeout(()=>child.kill(),120000);timer.unref();try{const [code]=await once(child,'exit');process.exitCode=code??1;}finally{clearTimeout(timer);}
