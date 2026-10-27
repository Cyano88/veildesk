import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createMandateClient} from '../src/mandate-client.mjs';
import {createMcpSession,serveMcp} from '../src/mcp.mjs';
process.umask(0o077);
const configPath=process.env.VEILDESK_CLIENT_CONFIG,stateDirectory=process.env.VEILDESK_CLIENT_STATE;
const configured=!!configPath&&!!stateDirectory&&isAbsolute(configPath)&&isAbsolute(stateDirectory);
let client;
const getClient=async()=>{
 if(!configured)throw Error('Unconfigured');
 if(!client)client=(async()=>{
  let config;try{config=JSON.parse(await readFile(configPath,'utf8'))}catch{throw Error('Configuration unavailable')}
  if(config.capability&&config.capability!=='prediction.mandate.validate.v1')throw Error('Only unpaid previews are available');
  return createMandateClient({config:{...config,allowLoopback:false},stateDirectory});
 })().catch(error=>{client=undefined;throw error});
 return client;
};
try{await serveMcp(process.stdin,process.stdout,createMcpSession({getClient,configured}))}catch{console.error('VeilDesk MCP transport stopped. No credentials or payloads logged.');process.exitCode=1}
