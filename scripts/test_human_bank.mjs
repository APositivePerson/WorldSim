import {build} from 'esbuild';
await build({entryPoints:[process.argv.includes('--arrival')?'tests/human_bank_arrival.ts':'tests/human_bank.ts'],outfile:'logs/human-bank-test.mjs',bundle:true,
  platform:'node',format:'esm',external:['module'],target:'es2022'});
await import('../logs/human-bank-test.mjs');
