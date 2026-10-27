import {backupPayments,restorePayments} from '../src/payment-backup.mjs';
process.umask(0o077);
const [action,source,target,...extra]=process.argv.slice(2);
if(!['backup','restore'].includes(action)||!source||!target||extra.length)throw Error('Usage: node scripts/payment-backup.mjs backup <database> <new-directory> | restore <backup-directory> <new-directory>');
const report=await (action==='backup'?backupPayments:restorePayments)(source,target);
console.log(JSON.stringify(report,null,2));
