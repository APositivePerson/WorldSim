import {build} from 'esbuild';
await build({entryPoints:['tests/scratch_dynamics.ts'],outfile:'logs/scratch-dynamics-test.mjs',bundle:true,platform:'node',format:'esm',external:['module'],target:'es2022'});
await import('../logs/scratch-dynamics-test.mjs');
