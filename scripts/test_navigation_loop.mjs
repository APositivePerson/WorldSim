import {spawn} from 'node:child_process';
import {build} from 'esbuild';

await build({entryPoints:['tests/navigation_closed_loop.ts'],outfile:'logs/navigation-closed-loop.mjs',bundle:true,platform:'node',format:'esm',external:['module']});
const brain=spawn('python',['-u','tests/navigation_brain_server.py'],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
let body;
const workers=new Set();
process.once('SIGINT',()=>{for(const p of workers)p.kill();brain.kill();body?.kill();process.exit(130);});
try{
 const address=await new Promise((resolve,reject)=>{
  let out='';const timer=setTimeout(()=>reject(Error('test brain startup timeout')),30000);
  brain.stdout.on('data',c=>{out+=c;const match=out.match(/ws:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  brain.stderr.on('data',c=>process.stderr.write(c));brain.on('error',reject);
 });
 body=spawn('python',['-u','body_3d.py','--port','0','--no-scan'],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
 const origin=await new Promise((resolve,reject)=>{
  let out='';const timer=setTimeout(()=>reject(Error('test body startup timeout')),30000);
  body.stdout.on('data',c=>{out+=c;const match=out.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  body.stderr.on('data',()=>{});body.on('error',reject);
 });
 function run(args){return new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,args,{windowsHide:true,stdio:'inherit'});
  workers.add(p);p.on('exit',()=>workers.delete(p));
  p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(`navigation test exited ${code}: ${args.join(' ')}`)));
 });}
 await run(['tests/browser_navigation_loop.cjs',address,origin]);
 if(!process.argv.includes('--bridge-only')){
  // Wait for every worker even if one fails, so no test process survives teardown.
  const cases=process.argv.find(a=>a.startsWith('--cases='))?.slice(8).split(',')??['normal','detour','blocked'];
  if(cases.some(k=>!['normal','detour','blocked'].includes(k)))throw Error('Unknown physical test case');
  const results=await Promise.allSettled(cases.map(kind=>run(['logs/navigation-closed-loop.mjs',kind,address])));
  for(const r of results)if(r.status==='rejected')throw r.reason;
 }
}finally{brain.kill();body?.kill();}
