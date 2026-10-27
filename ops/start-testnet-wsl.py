import os, pathlib, subprocess, tomllib, json, time
root=pathlib.Path.home()/'.local/share/veildesk-testnet'
wallet=root/'wallet'
node=root/'zebrad.toml'
walletcfg=wallet/'zallet.toml'
(root/'state').mkdir(exist_ok=True)
(root/'node-rpc').mkdir(exist_ok=True)
node.write_text('[network]\nnetwork = "Testnet"\nlisten_addr = "127.0.0.1:18233"\npeerset_initial_target_size = 8\n[rpc]\nlisten_addr = "127.0.0.1:18232"\ncookie_dir = "'+str(root/'node-rpc')+'"\nenable_cookie_auth = true\n[state]\ncache_dir = "'+str(root/'state')+'"\n[sync]\ndownload_concurrency_limit = 10\nparallel_cpu_threads = 2\n[tracing]\nuse_color = false\n')
s=walletcfg.read_text()
s=s.replace('#backend = "zebra"','backend = "zaino"').replace('network = "main"','network = "test"').replace('#validator_address = UNSET','validator_address = "127.0.0.1:18232"').replace('#validator_cookie_path = UNSET','validator_cookie_path = "'+str(root/'node-rpc'/'.cookie')+'"').replace('#bind = []','bind = ["127.0.0.1:28232"]')
walletcfg.write_text(s)
cfg=tomllib.loads(s)
assert cfg['consensus']['network']=='test'
assert cfg['rpc']['bind']==['127.0.0.1:28232']
assert tomllib.loads(node.read_text())['network']['network']=='Testnet'
os.chmod(root,0o700);os.chmod(wallet,0o700);os.chmod(walletcfg,0o600)
binary=root/'bin/zallet-v0.1.0-beta.3-linux-amd64/zallet'
with open(root/'wallet-init.log','a') as log:
 if not (wallet/'encryption-identity.txt').exists():
  subprocess.run([str(binary),'-d',str(wallet),'generate-encryption-identity'],stdout=log,stderr=log,check=True)
  subprocess.run([str(binary),'-d',str(wallet),'init-wallet-encryption'],stdout=log,stderr=log,check=True)
# Testnet services only; no seeds are exported and no transactions are sent.
for name,args in [('zebra',[str(root/'bin/zebrad'),'-c',str(node),'start']),('zallet',[str(binary),'-d',str(wallet),'start'])]:
 if name=='zallet':
  for attempt in range(60):
   if (root/'node-rpc'/'.cookie').exists(): break
   time.sleep(0.5)
  else: raise RuntimeError('Zebra RPC cookie did not become ready')
 pidfile=root/(name+'.pid')
 if pidfile.exists():
  try:
   pid=int(pidfile.read_text());os.kill(pid,0)
   if pathlib.Path('/proc/'+str(pid)+'/stat').read_text().split()[2]!='Z':
    print(name+': already running');continue
  except ProcessLookupError: pass
 with open(root/(name+'.log'),'a') as log:
  proc=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
 pidfile.write_text(str(proc.pid));print(name+': started pid '+str(proc.pid))
print('Network: testnet. RPC binds: loopback only. Wallet account/funding not created.')