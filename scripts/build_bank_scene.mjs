// Build the bank from this repository's character module and root npm workspace.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir,readFile,writeFile,readdir,cp,open,unlink} from 'node:fs/promises';
import {unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const character=path.join(root,'character');
const require=createRequire(path.join(root,'package.json'));
const outdir=path.join(root,'web/bank');
// A manual rebuild and a server startup may overlap; serialize asset copies.
await mkdir(outdir,{recursive:true});
const lockPath=path.join(root,'web/.bank-build.lock');
let locked=false;
for(let attempt=0;attempt<150;attempt++){
  try{const lock=await open(lockPath,'wx');await lock.writeFile(String(process.pid));await lock.close();locked=true;break;}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    try{
      const pid=Number(await readFile(lockPath,'utf8'));
      if(pid>0){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')await unlink(lockPath);}}
    }catch{/* Another builder just released its lock. */}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
}
if(!locked)throw Error('另一进程仍在构建银行场景，请稍后重试');
process.on('exit',()=>{try{unlinkSync(lockPath);}catch{}});
const assetsArg=process.argv.indexOf('--human-assets');
const assets=assetsArg<0?path.join(character,'public'):path.resolve(process.argv[assetsArg+1]);
async function files(dir){
  const entries=await readdir(dir,{withFileTypes:true});
  return (await Promise.all(entries.map(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat().sort();
}
const inputFiles=[...(await files(path.join(root,'scene'))),...(await files(path.join(root,'scenarios'))),
  ...(await files(path.join(character,'src'))),...(await files(path.join(assets,'models'))),
  fileURLToPath(import.meta.url),path.join(root,'package-lock.json'),path.join(character,'package.json'),
  path.join(character,'upstream-integration.json'),
  path.join(character,'public/motions/NOTICE.txt'),
  require.resolve('@mujoco/mujoco/mujoco.wasm')];
async function digest(paths){const hash=createHash('sha256');for(const file of paths)hash.update(file).update(await readFile(file));return hash.digest('hex');}
const fingerprint=await digest(inputFiles);
const manifestPath=path.join(outdir,'integration.json');
if(process.argv.includes('--if-needed')){
  try{
    const previous=JSON.parse(await readFile(manifestPath,'utf8'));
    if(previous.fingerprint===fingerprint&&await digest(previous.outputs)===previous.outputHash){
      console.log('人物源码、模型与银行构建已同步。');process.exit(0);
    }
  }catch{/* Missing, stale or damaged build: recreate from current sources. */}
}
await mkdir(outdir,{recursive:true});
const result=await build({entryPoints:[path.join(root,'scene/main.ts')],outdir,bundle:true,format:'esm',metafile:true,
  platform:'browser',target:'es2022',logLevel:'info',minify:true,
  external:['module'],
  nodePaths:[path.join(root,'node_modules')],publicPath:'/bank/',
  define:{'import.meta.env.BASE_URL':JSON.stringify('/bank/')},loader:{'.wasm':'file'},
  plugins:[{name:'wasm-url',setup(build){build.onResolve({filter:/\.wasm\?url$/},args=>({path:require.resolve(args.path.slice(0,-4))}));}}]});
const html=await readFile(path.join(root,'scene/index.html'),'utf8');
// Give every source revision a distinct URL so an iframe cannot reuse an old scene bundle.
await writeFile(path.join(outdir,'index.html'),html.replace('./main.ts',`./main.js?v=${fingerprint.slice(0,16)}`));
await cp(path.join(assets,'models'),path.join(outdir,'models'),{recursive:true});
await mkdir(path.join(outdir,'motions'),{recursive:true});
await cp(path.join(character,'public/motions/NOTICE.txt'),path.join(outdir,'motions/NOTICE.txt'));
const outputs=[...Object.keys(result.metafile.outputs).map(p=>path.resolve(p)),path.join(outdir,'index.html'),
  path.join(outdir,'motions/NOTICE.txt'),
  ...(await files(path.join(outdir,'models')))];
const humanSource=JSON.parse(await readFile(path.join(character,'upstream-integration.json'),'utf8'));
await writeFile(manifestPath,JSON.stringify({version:2,fingerprint,assets,outputs,outputHash:await digest(outputs),
  humanSource:{project:humanSource.sourceProject,revision:humanSource.revision,files:Object.keys(humanSource.files).length}},null,2));
