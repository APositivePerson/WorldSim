import {build} from 'esbuild';
await build({entryPoints:['tests/local_navigation.ts'],outfile:'logs/local-navigation.mjs',bundle:true,platform:'node',format:'esm'});
await import('../logs/local-navigation.mjs');
