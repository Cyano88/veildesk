import pathlib,subprocess,os,time,tomllib
root=pathlib.Path.home()/'.local/share/veildesk-testnet'
probe=root/'remote-probe'; probe.mkdir(mode=0o700,exist_ok=True)
wallet=probe/'wallet'; wallet.mkdir(mode=0o700,exist_ok=True)
binary=root/'bin/zallet-v0.1.0-beta.3-linux-amd64/zallet'
config=wallet/'zallet.toml'
if not config.exists():
 text=(root/'wallet/zallet.toml').read_text().replace('127.0.0.1:18232','127.0.0.1:18242').replace(str(root/'node-rpc/.cookie'),str(probe/'proxy.cookie')).replace('127.0.0.1:28232','127.0.0.1:28242')
 config.write_text(text); config.chmod(0o600)
cfg=tomllib.loads(config.read_text()); assert cfg['consensus']['network']=='test'; assert cfg['rpc']['bind']==['127.0.0.1:28242']; assert cfg['indexer']['validator_address']=='127.0.0.1:18242'
with (probe/'init.log').open('a') as log:
 if not (wallet/'encryption-identity.txt').exists():
  subprocess.run([str(binary),'-d',str(wallet),'generate-encryption-identity'],stdout=log,stderr=log,check=True)
  subprocess.run([str(binary),'-d',str(wallet),'init-wallet-encryption'],stdout=log,stderr=log,check=True)
for name,args in [('proxy',['python3','/mnt/c/Users/USER/Desktop/veildesk/ops/remote-testnet-proxy.py']),('zallet',[str(binary),'-d',str(wallet),'start'])]:
 pidfile=probe/(name+'.pid')
 if pidfile.exists():
  try:
   pid=int(pidfile.read_text()); os.kill(pid,0)
   if pathlib.Path('/proc/'+str(pid)+'/stat').read_text().split()[2]!='Z': print(name+': already running'); continue
  except ProcessLookupError: pass
 with (probe/(name+'.log')).open('a') as log: proc=subprocess.Popen(args,stdout=log,stderr=log,stdin=subprocess.DEVNULL,start_new_session=True)
 pidfile.write_text(str(proc.pid)); print(name+': started'); time.sleep(1)
print('Isolated testnet compatibility probe only. No accounts or sends. Original services untouched.')
