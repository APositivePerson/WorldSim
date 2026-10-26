import {build} from 'esbuild';
await build({entryPoints:['tests/bank_gait_speed.ts'],outfile:'logs/bank-gait-test.mjs',bundle:true,platform:'node',format:'esm',external:['module'],target:'es2022'});
await import('../logs/bank-gait-test.mjs');
await build({entryPoints:['tests/bank_counter_gait.ts'],outfile:'logs/bank-counter-test.mjs',bundle:true,platform:'node',format:'esm',external:['module'],target:'es2022'});
await import('../logs/bank-counter-test.mjs');
