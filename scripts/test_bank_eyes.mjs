import {build} from 'esbuild';
await build({entryPoints:['tests/bank_eye_binding.ts'],outfile:'logs/bank-eyes-test.mjs',bundle:true,platform:'node',format:'esm',external:['module'],target:'es2022'});
await import('../logs/bank-eyes-test.mjs');
