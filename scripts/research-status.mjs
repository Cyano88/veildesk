import {readFile} from 'node:fs/promises';
import {createPaidResearchClient} from '../src/mandate-client.mjs';
import {watchResearch} from '../src/research-progress.mjs';
const [configPath,stateDirectory,id]=process.argv.slice(2);
try{
 if(!configPath||!stateDirectory||!id)throw Error('arguments');
 const config=JSON.parse(await readFile(configPath,'utf8'));
 const client=await createPaidResearchClient({config,stateDirectory});
 const result=await watchResearch({client,id,onProgress:progress=>console.log(JSON.stringify(progress))});
 console.log(JSON.stringify(result));
 if(result.stage!=='fulfilled')process.exitCode=2;
}catch{console.error('Unable to verify research status. Preserve the existing request and payment records; do not resend payment.');process.exitCode=1}
