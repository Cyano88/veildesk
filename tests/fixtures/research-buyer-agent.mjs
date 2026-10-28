// Separate SDK consumer process. Secrets arrive only on the parent's private IPC channel.
import {createPaidResearchClient} from '../../src/mandate-client.mjs';
let client;
let queue=Promise.resolve();
process.on('message', message => {
  queue=queue.then(async()=>{
    try {
      let result;
      if(message.method==='initialize'){
        if(client)throw Error('Already initialized');
        client=await createPaidResearchClient(message.options);
        result={pid:process.pid,role:'buyer'};
      }else{
        if(!client||!['submit','get','submitPaymentHint'].includes(message.method))throw Error('Unsupported buyer operation');
        result=await client[message.method](...message.args);
      }
      process.send({id:message.id,ok:true,result});
    }catch{process.send({id:message.id,ok:false,error:'Buyer operation failed'});}
  });
});
process.on('disconnect',()=>process.exit(0));
