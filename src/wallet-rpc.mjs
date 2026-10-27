import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// Read-only readiness transport. No spend, seed export or arbitrary RPC passthrough.
const allowed=new Set(['rpc.discover','getwalletstatus','getblockchaininfo','z_viewtransaction','z_getaccount','getrawtransaction','getblockhash']);
export function walletRpc({url,cookieFile,timeoutMs=10000}){
 const endpoint=new URL(url);
 if(endpoint.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('Use a literal loopback HTTP RPC URL without credentials');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid RPC timeout');
 return async(method,params=[])=>{
  if(!allowed.has(method))throw Error('RPC method is not allowed by the readiness client');
  if(!Array.isArray(params))throw Error('RPC parameters must be an array');
  const headers={'Content-Type':'application/json'};
  if(cookieFile){const cookie=(await readFile(cookieFile,'utf8')).trim();if(!cookie.includes(':')||/[\r\n]/.test(cookie))throw Error('Invalid RPC cookie');headers.Authorization='Basic '+Buffer.from(cookie).toString('base64')}
  const id=randomUUID();let response;
  try{response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id,method,params}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)})}catch{throw Error('Wallet RPC unreachable or timed out')}
  if(!response.ok)throw Error(`Wallet RPC HTTP ${response.status}`);
  const raw=await response.text();if(raw.length>4*1024*1024)throw Error('RPC response too large');
  let result;try{result=JSON.parse(raw)}catch{throw Error('Malformed wallet RPC response')}
  if(result.id!==id||result.error||!Object.hasOwn(result,'result'))throw Error('Wallet RPC returned an error or mismatched response');
  return result.result;
 };
}

export async function inspectWallet(rpc){
 const discovery=await rpc('rpc.discover');
 if(!Array.isArray(discovery?.methods))throw Error('Wallet did not provide an OpenRPC method catalog');
 const methods=new Set(discovery.methods.map(m=>m.name));
 const expected=['getwalletstatus','z_viewtransaction','z_listtransactions','z_getnewaccount','z_getaddressforaccount','z_sendmany','z_getoperationstatus'];
 return {walletInterface:'zallet',methods:expected.map(name=>({name,available:methods.has(name)})),legacyReceiptMethod:methods.has('z_listreceivedbyaddress'),paymentAdapterReady:false,reason:'Receipt adapter requires verification against the running wallet schema and a real testnet payment.'};
}

