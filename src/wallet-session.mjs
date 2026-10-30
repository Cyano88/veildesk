// The pinned CLI prints two JSON objects followed by its quit acknowledgement.
// Reject extra output and missing results, including successful process exits
// after an individual command failed. Never include raw wallet output in errors.
export function parseWalletSession(output){
 const values=[];let rest=output.trim();
 for(let item=0;item<2;item++){
  if(rest[0]!=='{')throw Error('wallet_session_invalid_output');
  let depth=0,quoted=false,escaped=false,end=-1;
  for(let i=0;i<rest.length;i++){
   const c=rest[i];
   if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}
   if(c==='"')quoted=true;
   else if(c==='{')depth++;
   else if(c==='}'&&--depth===0){end=i+1;break}
  }
  if(end<0)throw Error('wallet_session_invalid_output');
  try{values.push(JSON.parse(rest.slice(0,end)))}catch{throw Error('wallet_session_invalid_output')}
  rest=rest.slice(end).trim();
 }
 if(rest!=='Zingo CLI quit successfully.')throw Error('wallet_session_invalid_output');
 const [info,progress]=values;
 if(typeof info.chain_name!=='string'||!Number.isSafeInteger(info.latest_block_height)
  ||!Number.isSafeInteger(progress.sync_start_height))throw Error('wallet_session_invalid_output');
 return {info,progress};
}
