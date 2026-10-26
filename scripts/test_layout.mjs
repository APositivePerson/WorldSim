import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('logs',{recursive:true});
await build({entryPoints:['tests/layout.ts'],bundle:true,platform:'node',format:'esm',outfile:'logs/layout-test.mjs'});
await import('../logs/layout-test.mjs?'+Date.now());
