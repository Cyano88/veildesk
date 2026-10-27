// Copy into a server-side app after installing the local VeilDesk package.
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createMandateClient} from 'veildesk/mandate-client';

const configPath=process.env.VEILDESK_CLIENT_CONFIG;
const stateDirectory=process.env.VEILDESK_CLIENT_STATE;
if(!configPath||!stateDirectory||!isAbsolute(configPath)||!isAbsolute(stateDirectory))throw Error('Set absolute operator-owned client config and persistent state paths');
const config=JSON.parse(await readFile(configPath,'utf8'));
const client=await createMandateClient({config,stateDirectory});
const [action,arg,txid]=process.argv.slice(2);
let result;
if(action==='submit'&&arg)result=await client.submit(JSON.parse(await readFile(arg,'utf8')));
else if(action==='get'&&arg)result=await client.get(arg);
else if(action==='payment'&&arg&&txid)result=await client.submitPaymentHint(arg,txid);
else throw Error('Use submit <mandate.json>, get <job-id>, or payment <job-id> <already-sent-txid>');
// This output can contain decrypted private data. Return it only to the authorized caller.
process.stdout.write(JSON.stringify(result)+'\n');
