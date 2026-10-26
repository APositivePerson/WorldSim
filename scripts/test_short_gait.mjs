import {build} from 'esbuild';
await build({entryPoints:['tests/short_gait.ts'],outfile:'logs/short-gait-test.mjs',bundle:true,platform:'node',format:'esm',external:['module'],target:'es2022'});
await import('../logs/short-gait-test.mjs');
