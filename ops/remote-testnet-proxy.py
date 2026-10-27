import json, pathlib, http.server, urllib.request, urllib.error, secrets, base64, os, sys, threading, time
# Dedicated read-only TLS bridge for the isolated Zallet compatibility probe.
# Never forwards wallet cookies, private keys, send calls or arbitrary URLs.
ROOT=pathlib.Path.home()/'.local/share/veildesk-testnet/remote-probe'
UPSTREAM='https://zcash-testnet-zebrad.gateway.tatum.io'
ALLOWED={'getinfo','getnetworkinfo','getblockchaininfo','getblockcount','getbestblockhash','getblockhash','getblock','getblockheader','getrawtransaction','getrawmempool','getaddressbalance','getaddressutxos','getaddresstxids','z_gettreestate','z_getsubtreesbyindex'}
ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
COOKIE=ROOT/'proxy.cookie'
if not COOKIE.exists(): COOKIE.write_text('__cookie__:'+secrets.token_hex(32)); COOKIE.chmod(0o600)
AUTH='Basic '+base64.b64encode(COOKIE.read_bytes()).decode()
UPSTREAM_LOCK=threading.Lock()
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  try:
   if self.headers.get('Authorization')!=AUTH: self.send_error(401); return
   n=int(self.headers.get('Content-Length','0'))
   if not 0<n<=65536: self.send_error(413); return
   data=self.rfile.read(n); req=json.loads(data)
   if not isinstance(req,dict) or req.get('method') not in ALLOWED: self.send_error(403); return
   upstream=urllib.request.Request(UPSTREAM,data=data,headers={'Content-Type':'application/json'})
   with UPSTREAM_LOCK:
    for attempt in range(4):
     time.sleep(1 if attempt==0 else 2**attempt)
     try:
      with urllib.request.urlopen(upstream,timeout=25) as response: body=response.read(32*1024*1024+1); status=response.status
     except urllib.error.HTTPError as e: status=e.code; body=e.read(65536)
     if status!=429: break
   if len(body)>32*1024*1024: self.send_error(502); return
   self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
  except Exception: self.send_error(502)
if __name__=='__main__': http.server.ThreadingHTTPServer(('127.0.0.1',18242),Handler).serve_forever()

