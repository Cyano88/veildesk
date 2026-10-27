"""Build the npm artifact and recover across fresh local containers. No live wallets."""
import hashlib,json,os,pathlib,secrets,shutil,subprocess,sys,tarfile,tempfile,time,uuid
source=pathlib.Path(__file__).resolve().parents[1]
package=pathlib.Path(sys.argv[1]).resolve()
root=pathlib.Path(tempfile.mkdtemp(prefix='veildesk-recovery-'))
image='veildesk:recovery-'+uuid.uuid4().hex[:12]
env=dict(os.environ,VEILDESK_CHECKPOINT_PASSWORD=secrets.token_urlsafe(36))
try:
 context=root/'context';context.mkdir()
 with tarfile.open(package) as archive:archive.extractall(context,filter='data')
 subprocess.run(['docker','build','-t',image,str(context/'package')],check=True)
 transfer=root/'transfer';transfer.mkdir();os.chown(transfer,1000,1000);os.chmod(transfer,0o700);os.chmod(root,0o755)
 reports=[]
 for mode in ['create','restore']:
  command=['docker','run','--rm','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,size=128m,mode=1777','-v',str(transfer)+':/transfer','-v',str(source/'ops/container-recovery-check.mjs')+':/run/check.mjs:ro','-e','VEILDESK_CHECKPOINT_PASSWORD',image,'node','/run/check.mjs',mode]
  result=subprocess.run(command,env=env,text=True,capture_output=True,timeout=90)
  if result.returncode:raise RuntimeError(result.stderr)
  reports.append(json.loads(result.stdout.strip().splitlines()[-1]))
 report={'schema':'veildesk.container-recovery.v1','checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'packageSha256':hashlib.sha256(package.read_bytes()).hexdigest(),'harnessSha256':hashlib.sha256((source/'ops/container-recovery-check.mjs').read_bytes()).hexdigest(),'imageId':subprocess.check_output(['docker','image','inspect',image,'--format','{{.Id}}'],text=True).strip(),'passed':True,'network':'none','reports':reports,'scope':'Two fresh local Linux containers from packaged artifact; no live payment, remote-host recovery, TLS deployment or marketplace acceptance'}
 (source/'output/container-recovery-acceptance.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
finally:
 assert root.parent==pathlib.Path(tempfile.gettempdir()) and root.name.startswith('veildesk-recovery-')
 shutil.rmtree(root)
