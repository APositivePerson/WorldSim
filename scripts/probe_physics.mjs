import {build} from 'esbuild';
await build({entryPoints:[process.argv.includes('--obstacle')?'tests/obstacle_navigation.ts':process.argv.includes('--integration')?'tests/character_integration.ts':process.argv.includes('--route')?'tests/physical_route.ts':'tests/physical_probe.ts'],outfile:'logs/physical-probe.mjs',bundle:true,platform:'node',format:'esm',external:['module'],target:'es2022'});
await import('../logs/physical-probe.mjs');
