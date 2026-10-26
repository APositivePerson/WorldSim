// Copy exactly the publishable repository files into a fresh directory with no
// sibling character checkout, installed dependencies, local secrets or scans.
import {execFileSync} from 'node:child_process';
import {copyFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.join(root,'logs',`standalone-${Date.now()}`);
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of files){
  if(file==='.env'||file.startsWith('.env.')&&file!=='.env.example'
    ||/(^|\/)(node_modules|scanned-private|\.git|\.npm-cache)(\/|$)/.test(file)
    ||file.startsWith('logs/')||file.startsWith('web/bank/'))continue;
  const target=path.join(destination,file);await mkdir(path.dirname(target),{recursive:true});
  await copyFile(path.join(root,file),target);
}
console.log(destination);
