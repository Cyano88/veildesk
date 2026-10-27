import {readFile} from 'node:fs/promises';
import {createMandateClient} from '../src/mandate-client.mjs';
const config=JSON.parse(await readFile(process.env.VEILDESK_CLIENT_CONFIG,'utf8'));
const client=await createMandateClient({config,stateDirectory:process.env.VEILDESK_CLIENT_STATE});
const [action,arg,txid]=process.argv.slice(2);
if(action==='submit'&&arg)console.log(JSON.stringify(await client.submit(JSON.parse(await readFile(arg,'utf8')))));
else if(action==='get'&&arg)console.log(JSON.stringify(await client.get(arg)));
else if(action==='payment'&&arg&&txid)console.log(JSON.stringify(await client.submitPaymentHint(arg,txid)));
else throw Error('Use submit <private-mandate-file>, get <job-id>, or payment <job-id> <txid>');
