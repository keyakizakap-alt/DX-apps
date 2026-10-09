import http from 'node:http';
import fs from 'node:fs/promises';
import { createWorker } from '../server/worker.mjs';
import { WORKFLOW_AGENTS,PARAGRAPH_AGENT } from '../dist/agents.js';
const assets={};const types={html:'text/html',js:'text/javascript',css:'text/css'};
for(const file of await fs.readdir(new URL('../dist/',import.meta.url))){const ext=file.split('.').at(-1);if(types[ext])assets['/'+file]={type:types[ext]+'; charset=utf-8',content:await fs.readFile(new URL('../dist/'+file,import.meta.url),'utf8')};}
const worker=createWorker(assets,[...WORKFLOW_AGENTS,PARAGRAPH_AGENT]);
const origin='http://127.0.0.1:4173';
http.createServer(async(req,res)=>{
  const body=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>750000){res.writeHead(413);res.end();return;}body.push(chunk);}
  const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','local-developer');headers.set('oai-authenticated-user-email','local@development.invalid');
  const request=new Request(origin+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(body)});
  const response=await worker.fetch(request,{ALLOWED_USER_EMAILS:'local@development.invalid',SITE_ORIGIN:origin,OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY,AI_PROVIDER:process.env.AI_PROVIDER,GROQ_API_KEY:process.env.GROQ_API_KEY,GROQ_MODELS:process.env.GROQ_MODELS,GROQ_ZDR_CONFIRMED:process.env.GROQ_ZDR_CONFIRMED,GROQ_MAX_OUTPUT_TOKENS:process.env.GROQ_MAX_OUTPUT_TOKENS});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}).listen(4173,'127.0.0.1',()=>console.log('Local preview: '+origin+' (development identity only)'));
