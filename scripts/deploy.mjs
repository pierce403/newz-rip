#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const config=JSON.parse((await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8')).replace(/^\s*\/\/.*$/gm,''));
if(!config.d1_databases?.[0]?.database_id || config.d1_databases[0].database_id==='00000000-0000-0000-0000-000000000000'){
  console.error('Configure a real D1 database ID first. Run npm run setup:cloudflare or follow README.md.');process.exit(1);
}
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
