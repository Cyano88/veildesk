import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
const directory=resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Usage: node scripts/provision-relay.mjs <private-directory>');
// A fresh directory prevents partial reruns from mixing old and new identities.
await mkdir(directory,{mode:0o700});
async function save(name,value){const h=await open(join(directory,name),'wx',0o600);try{await h.writeFile(JSON.stringify(value,null,2));await h.sync()}finally{await h.close()}}
async function keys(name,usage){const pair=await crypto.subtle.generateKey({name,namedCurve:'P-256'},true,usage);return {privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey),publicKey:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64')}}
const client={encryption:await keys('ECDH',['deriveBits']),signing:await keys('ECDSA',['sign','verify'])};
const provider={encryption:await keys('ECDH',['deriveBits']),signing:await keys('ECDSA',['sign','verify'])};
const clientToken=randomBytes(32).toString('base64url'),providerToken=randomBytes(32).toString('base64url'),hash=x=>createHash('sha256').update(x).digest('hex');
const publicProvider={id:'veildesk-validation',encryptionKey:provider.encryption.publicKey,signingKey:provider.signing.publicKey,capabilities:['prediction.mandate.validate.v1']};
await save('relay.json',{database:join(directory,'relay.db'),principals:[{id:'polydesk',role:'client',tokenHash:hash(clientToken)},{id:publicProvider.id,role:'provider',tokenHash:hash(providerToken)}],providers:[publicProvider]});
await save('provider.json',{id:publicProvider.id,url:'http://127.0.0.1:5181',allowLoopback:true,token:providerToken,identity:provider,stateDirectory:join(directory,'provider-state'),peers:{polydesk:{encryptionKey:client.encryption.publicKey,signingKey:client.signing.publicKey}}});
await save('client.json',{url:'http://127.0.0.1:5181',allowLoopback:true,token:clientToken,identity:client,provider:publicProvider});
console.log('Created relay.json, provider.json and client.json in the private directory. No credentials printed. Keep this directory outside source control and backups encrypted.');
