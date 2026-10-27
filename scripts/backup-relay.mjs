import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,writeFile,chmod} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';
const [source,target]=process.argv.slice(2);if(!source||!target)throw Error('Usage: node scripts/backup-relay.mjs <database> <new-backup-directory>');
process.umask(0o077);const directory=resolve(target);await mkdir(directory,{mode:0o700});
const db=new DatabaseSync(resolve(source),{readOnly:true});
try{
 const file=join(directory,'relay.db');await backup(db,file);await chmod(file,0o600);
 const check=new DatabaseSync(file,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed')}finally{check.close()}
 await writeFile(join(directory,'manifest.json'),JSON.stringify({schema:'veildesk.relay-backup.v1',createdAt:new Date().toISOString(),sha256:createHash('sha256').update(await readFile(file)).digest('hex'),scope:'relay_database_only',endpointKeysIncluded:false,providerLedgerIncluded:false},null,2),{mode:0o600});
 console.log('Relay database backup verified. Endpoint identities and client/provider ledgers require separate protected backups.');
}finally{db.close()}
