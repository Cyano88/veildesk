import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const files={'/':'web/index.html','/app.mjs':'web/app.mjs','/style.css':'web/style.css','/envelope.mjs':'src/envelope.mjs','/authenticated.mjs':'src/authenticated.mjs'};
createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
 res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.writeHead(405).end();return}
 const name=files[req.url];if(!name){res.writeHead(404).end();return}
 try{const body=await readFile(new URL(name,import.meta.url));res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript');res.end(body)}catch{res.writeHead(500).end('Unavailable')}
}).listen(5180,'127.0.0.1',()=>console.log('VeilDesk prototype: http://127.0.0.1:5180'));
