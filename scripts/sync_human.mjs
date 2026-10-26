// Import public source/assets from the sibling project; bank adapters stay local.
import {readFile,writeFile,readdir,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.join(root,'character');
const manifestPath=path.join(destination,'upstream-integration.json');
const sha=data=>createHash('sha256').update(data).digest('hex');
const maybe=async file=>{try{return await readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
if(process.argv.includes('--check')){
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  for(const [file,hash] of Object.entries(manifest.files)){
    const content=await maybe(path.join(destination,file));
    if(!content||sha(content)!==hash)throw Error(`人物模块与同步记录不同：character/${file}`);
  }
  console.log(`已核对 ${Object.keys(manifest.files).length} 个人物源码/公开资产文件。`);
}else{
  const at=process.argv.indexOf('--source');
  const source=path.resolve(at<0?path.join(root,'../HumanSimulation-main'):process.argv[at+1]);
  if(source===destination||source===root)throw Error('来源必须是独立的 HumanSimulation-main');
  const roots=['src','public','scripts','tests','docs','assets','package.json','tsconfig.json','vite.config.ts','playwright.config.ts','README.md','index.html'];
  const previous=await maybe(manifestPath),old=previous?JSON.parse(previous).files:{};
  const files={};const changes=[];
  async function collect(relative){
    const full=path.join(source,relative);
    let entries;
    try{entries=await readdir(full,{withFileTypes:true});}
    catch(e){if(e.code!=='ENOTDIR')throw e;}
    if(entries){
      for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
        if(entry.isSymbolicLink())throw Error(`不导入符号链接：${relative}/${entry.name}`);
        if(['node_modules','__pycache__','raw','scanned-private'].includes(entry.name))continue;
        await collect(path.join(relative,entry.name));
      }
    }else{
      const data=await readFile(full),hash=sha(data),target=await maybe(path.join(destination,relative));
      files[relative]=hash;
      if(!target||sha(target)!==hash){
        if(target&&old[relative]&&sha(target)!==old[relative])throw Error(`目标存在本地改动，请先合并：character/${relative}`);
        changes.push(relative);
      }
    }
  }
  for(const name of roots)await collect(name);
  if(!process.argv.includes('--apply'))console.log(`待同步 ${changes.length} 个文件。添加 --apply 执行。`);
  else{
    for(const file of changes){await mkdir(path.dirname(path.join(destination,file)),{recursive:true});await copyFile(path.join(source,file),path.join(destination,file));}
    await writeFile(manifestPath,JSON.stringify({version:1,sourceProject:'HumanSimulation-main',
      scope:'Public source and assets; excludes private scans, caches and build outputs',
      revision:sha(JSON.stringify(files)),files},null,2)+'\n');
    console.log(`已同步 ${changes.length} 个文件，共记录 ${Object.keys(files).length} 个文件。`);
  }
}
