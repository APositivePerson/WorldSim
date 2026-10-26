import {build} from 'esbuild';
await build({entryPoints:['tests/upstream_speed_audit.ts'],outfile:'logs/upstream-speed-audit.mjs',bundle:true,platform:'node',format:'esm',external:['module'],target:'es2022'});
await import('../logs/upstream-speed-audit.mjs');
