import {createCheckpoint,restoreCheckpoint} from '../src/checkpoint.mjs';
process.umask(0o077);
const [action,source,target,flag]=process.argv.slice(2),password=process.env.VEILDESK_CHECKPOINT_PASSWORD;
delete process.env.VEILDESK_CHECKPOINT_PASSWORD;
if(action==='backup'&&flag==='--services-stopped')console.log(JSON.stringify(await createCheckpoint({directory:source,file:target,password,servicesStopped:true})));
else if(action==='restore'&&!flag)console.log(JSON.stringify(await restoreCheckpoint({file:source,directory:target,password})));
else throw Error('Usage: checkpoint.mjs backup <private-root> <new-encrypted-file> --services-stopped | restore <encrypted-file> <new-private-root>');
