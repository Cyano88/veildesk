import {fork} from 'node:child_process';
import {once} from 'node:events';
export async function createBuyerProcess(options){
  const child=fork(new URL('./research-buyer-agent.mjs',import.meta.url),[],{execArgv:[],
    stdio:['ignore','ignore','ignore','ipc'],env:{SystemRoot:process.env.SystemRoot,NODE_NO_WARNINGS:'1'}});
  const pending=new Map();let sequence=0;
  child.on('message',message=>{
    const call=pending.get(message.id);if(!call)return;
    pending.delete(message.id);clearTimeout(call.timer);
    if(message.ok)call.resolve(message.result);else call.reject(Error(message.error));
  });
  child.on('exit',()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(Error('Buyer process exited'));}pending.clear();});
  function call(method,args=[],extra={}){return new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Buyer operation timed out'));},15000);
    pending.set(id,{resolve,reject,timer});child.send({id,method,args,...extra},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
  });}
  try{
    const {pid}=await call('initialize',[],{options});
    return {pid,submit:purchase=>call('submit',[purchase]),get:id=>call('get',[id]),
      submitPaymentHint:(id,txid)=>call('submitPaymentHint',[id,txid]),
      async close(){if(child.exitCode!==null)return;const exited=once(child,'exit');
        const timer=setTimeout(()=>child.kill(),5000);child.disconnect();try{await exited;}finally{clearTimeout(timer);}}};
  }catch(error){child.kill();throw error;}
}
