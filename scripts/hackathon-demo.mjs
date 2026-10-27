import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=(await readdir(new URL('../tests/',import.meta.url))).filter(n=>n.endsWith('.test.mjs')).map(n=>'tests/'+n);
const cases=[['authenticated_coordination',['scripts/demo.mjs']],['receipt_and_security_fixtures',['--test',...tests]]];
const runs=cases.map(([name,args])=>{
 const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:60000});
 return {name,passed:result.status===0,exitCode:result.status,stdout:result.stdout||'',stderr:result.stderr||'',error:result.error?.message};
});
const report={schema:'veildesk.demo-evidence.v1',generatedAt:new Date().toISOString(),scope:'Local authenticated coordination and synthetic wallet RPC evidence. Not an on-chain payment.',realShieldedPaymentCompleted:false,tradeSubmitted:false,deployed:false,okxListed:false,runs};
await mkdir(new URL('../output/',import.meta.url),{recursive:true});
await writeFile(new URL('../output/hackathon-evidence.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
for(const run of runs)console.log(`${run.passed?'PASS':'FAIL'} ${run.name}\n${run.stdout}`);
console.log('Evidence: output/hackathon-evidence.json. Real shielded settlement remains pending.');
if(runs.some(r=>!r.passed))process.exitCode=1;
