"""Local Docker acceptance only. No wallet, external service or marketplace calls."""
import base64,hashlib,json,os,pathlib,secrets,subprocess,tempfile,time,urllib.request,uuid
image=os.environ.get('VEILDESK_CONTAINER_IMAGE','veildesk:acceptance-20261027')
source=pathlib.Path(__file__).resolve().parents[1]
name='veildesk-check-'+uuid.uuid4().hex[:12]
root=pathlib.Path(tempfile.mkdtemp(prefix='veildesk-container-'))
data=root/'data';data.mkdir();os.chown(data,1000,1000);os.chmod(data,0o700);os.chmod(root,0o755)
token=secrets.token_urlsafe(32)
config={'database':'/data/relay.db','principals':[{'id':'client','role':'client','tokenHash':hashlib.sha256(token.encode()).hexdigest()},{'id':'provider','role':'provider','tokenHash':hashlib.sha256(secrets.token_bytes(32)).hexdigest()}],'providers':[{'id':'provider','encryptionKey':'unused-in-relay-runtime-check','signingKey':'unused-in-relay-runtime-check','capabilities':['prediction.mandate.validate.v1']}]}
configpath=root/'relay.json';configpath.write_text(json.dumps(config));os.chmod(configpath,0o644)
def docker(*args): return subprocess.check_output(['docker',*args],text=True,stderr=subprocess.PIPE).strip()
def start():
 docker('run','-d','--name',name,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','-p','127.0.0.1::5181','-v',str(data)+':/data','-v',str(configpath)+':/run/relay.json:ro','-e','VEILDESK_RELAY_CONFIG=/run/relay.json','-e','VEILDESK_BIND=0.0.0.0','-e','VEILDESK_BEHIND_TLS_PROXY=true',image)
 address=docker('port',name,'5181/tcp');url='http://'+address
 for _ in range(40):
  try:
   with urllib.request.urlopen(url+'/healthz',timeout=2) as r:
    if json.load(r).get('status')=='ok':return url
  except Exception:time.sleep(.25)
 raise RuntimeError('Container never became healthy')
def call(url,path,body=None):
 headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
 req=urllib.request.Request(url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 with urllib.request.urlopen(req,timeout=5) as response:return json.load(response)
checks=[]
try:
 url=start();checks.append('health_endpoint')
 assert docker('exec',name,'node','-p','process.getuid()')=='1000';checks.append('non_root_uid_1000')
 state=json.loads(docker('inspect',name))[0];assert state['HostConfig']['ReadonlyRootfs'];assert 'ALL' in state['HostConfig']['CapDrop'];assert state['HostConfig']['PortBindings']['5181/tcp'][0]['HostIp']=='127.0.0.1';checks.append('read_only_rootfs_dropped_capabilities_loopback_port')
 jobid=str(uuid.uuid4())
 js="import {identity,seal} from './src/envelope.mjs'; const peer=await identity(); console.log(JSON.stringify(await seal({secret:'container-persistence-marker'},peer.publicKey,'"+jobid+"','request')));"
 envelope=json.loads(docker('exec','-w','/app',name,'node','--input-type=module','-e',js))
 body={'id':jobid,'provider':'provider','capability':'prediction.mandate.validate.v1','expiresAt':int(time.time()*1000)+60000,'envelope':envelope}
 assert call(url,'/v1/jobs',body)['state']=='queued';checks.append('opaque_encrypted_submission')
 docker('stop','-t','10',name);docker('rm',name)
 url=start();assert call(url,'/v1/jobs/'+jobid)['state']=='queued';checks.append('persistent_volume_after_container_recreation')
 assert call(url,'/v1/jobs',body)['id']==jobid;checks.append('idempotent_retry_after_recreation')
 info={'schema':'veildesk.container-acceptance.v1','checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'imageId':docker('image','inspect',image,'--format','{{.Id}}'),'runtime':docker('exec',name,'node','--version'),'checks':checks,'passed':True,'scope':'Local relay container runtime and persistence; no provider execution, deployed TLS, payment or marketplace acceptance'}
 out=source/'output/container-acceptance.json';out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(info,indent=2));print(json.dumps(info,indent=2))
finally:
 subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 # Only this script's private mkdtemp workspace is eligible for cleanup.
 import shutil
 assert root.parent==pathlib.Path(tempfile.gettempdir()) and root.name.startswith('veildesk-container-')
 shutil.rmtree(root)
