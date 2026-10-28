import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
const files=new Map([
 ['/', ['../web/index.html','text/html; charset=utf-8']],
 ['/app.mjs',['../web/app.mjs','text/javascript; charset=utf-8']],
 ['/style.css',['../web/style.css','text/css; charset=utf-8']],
 ['/envelope.mjs',['./envelope.mjs','text/javascript; charset=utf-8']],
 ['/authenticated.mjs',['./authenticated.mjs','text/javascript; charset=utf-8']],
 ['/demo.mp4',['../web/demo.mp4','video/mp4']],
 ['/evidence/mainnet-pilot.json',['../web/evidence/mainnet-pilot.json','application/json; charset=utf-8']],
]);
// Only source-controlled public files; never resolve caller-supplied paths.
export async function servePublicSite(req,res){
 const entry=files.get((req.url??'').split('?')[0]);if(!entry)return false;
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
 res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',entry[1]);
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');res.writeHead(405).end();return true;}
 const file=new URL(entry[0],import.meta.url);let size;
 try{size=(await stat(file)).size;}catch{res.writeHead(503).end('Public asset unavailable');return true;}
 let start=0,end=size-1,status=200;res.setHeader('Accept-Ranges','bytes');
 if(req.headers.range){
  const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
  if(m){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;}
  if(!m||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.setHeader('Content-Range',`bytes */${size}`);res.writeHead(416).end();return true;}
  status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
 }
 res.setHeader('Content-Length',end-start+1);res.writeHead(status);
 if(req.method==='HEAD'){res.end();return true;}
 try{await pipeline(createReadStream(file,{start,end}),res);}catch{res.destroy();}
 return true;
}
