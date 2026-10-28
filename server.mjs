import {createServer} from 'node:http';
import {servePublicSite} from './src/public-site.mjs';
const port=Number(process.env.PORT||5180);
createServer(async(req,res)=>{if(!await servePublicSite(req,res))res.writeHead(404).end('Not found');}).listen(port,'127.0.0.1',()=>console.log('VeilDesk walkthrough: http://127.0.0.1:'+port));
