import fs from 'node:fs/promises';
import { WORKFLOW_AGENTS } from '../dist/agents.js';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const assets={};
for(const file of await fs.readdir(new URL('../dist/',import.meta.url))){
  const extension=file.slice(file.lastIndexOf('.'));
  if(types[extension])assets['/'+file]={type:types[extension],content:await fs.readFile(new URL('../dist/'+file,import.meta.url),'utf8')};
}
const security=(await fs.readFile(new URL('../dist/security.js',import.meta.url),'utf8')).replace(/^export /gm,'');
const worker=(await fs.readFile(new URL('../server/worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const specs=WORKFLOW_AGENTS.filter(a=>a.role!=='local').map(({id,role,instruction,schema})=>({id,role,instruction,schema}));
await fs.mkdir(new URL('../dist/server/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../dist/server/index.js',import.meta.url),security+'\n'+worker+`\nexport default createWorker(${JSON.stringify(assets)},${JSON.stringify(specs)});\n`);
const path=new URL('../.openai/hosting.json',import.meta.url);
try {
  const manifest=JSON.parse(await fs.readFile(path,'utf8'));
  delete manifest.static;
  await fs.writeFile(path,JSON.stringify(manifest,null,2)+'\n');
} catch(error) { if(error.code!=='ENOENT')throw error; }
await fs.mkdir(new URL('../public/',import.meta.url),{recursive:true});
console.log('Worker built with authenticated same-origin AI gateway and embedded static assets.');
