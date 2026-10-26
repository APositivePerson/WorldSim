import {build} from 'esbuild';
await build({entryPoints:['tests/simulation_clock.ts'],outfile:'logs/simulation-clock-test.mjs',bundle:true,platform:'node',format:'esm',target:'es2022'});
await import('../logs/simulation-clock-test.mjs');
