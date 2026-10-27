// Render supplies credentials as a secret file or a secret environment variable.
// Only runtime state paths and the provider's relay URL are overridden here.
export function renderConfig(role,source,{dataDirectory='/var/data',relayUrl}={}){
 if(!['relay','provider'].includes(role)||!source||typeof source!=='object')throw Error('Invalid Render role/configuration');
 if(dataDirectory!=='/var/data')throw Error('Render state requires the /var/data persistent disk');
 const config=structuredClone(source);
 if(role==='relay'){
  if(!Array.isArray(config.principals)||!Array.isArray(config.providers))throw Error('Missing relay enrollment configuration');
  config.database='/var/data/relay.db';
 }else{
  if(!config.identity||!config.peers||!config.token)throw Error('Missing provider identity/enrollment configuration');
  const url=new URL(relayUrl||config.url);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Render provider requires a public HTTPS relay URL');
  config.url=url.origin;config.allowLoopback=false;config.stateDirectory='/var/data/provider-state';
 }
 return config;
}
