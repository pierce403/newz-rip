#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

// Explicit setup command only. Credentials stay in environment variables and
// are never written to the project or logged.
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token || !/^[a-f0-9]{32}$/i.test(account)) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN before running setup.');
  process.exit(1);
}
const configPath = new URL('../wrangler.jsonc', import.meta.url);
const original = await readFile(configPath, 'utf8');
const config = JSON.parse(original.replace(/^\s*\/\/.*$/gm, ''));
const databaseName = config.d1_databases?.[0]?.database_name;
const bucketName = config.r2_buckets?.[0]?.bucket_name;
if (!databaseName || !bucketName) throw new Error('The D1/R2 configuration is missing.');
async function api(path, method='GET', body) {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,{
    method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    ...(body ? {body:JSON.stringify(body)} : {}),redirect:'error',signal:AbortSignal.timeout(30000)
  });
  const data=await response.json();
  if(!response.ok || !data.success) {
    // Use Cloudflare's numeric codes, never print the token, raw HTTP request or headers.
    throw new Error(`Cloudflare ${method} ${path.split('?')[0]} failed (HTTP ${response.status}; codes ${(data.errors??[]).map(e=>e.code).join(',')}). Check the account and token permissions.`);
  }
  return data.result;
}
try {
  let database;
  for(let page=1;page<=100;page++) {
    const list=await api(`d1/database?name=${encodeURIComponent(databaseName)}&per_page=100&page=${page}`);
    database=(list??[]).find(item=>item.name===databaseName);
    if(database || (list??[]).length<100)break;
  }
  if(!database)database=await api('d1/database','POST',{name:databaseName});
  if(!database.uuid || !/^[a-f0-9-]{36}$/i.test(database.uuid))throw new Error('Cloudflare did not return a valid D1 database ID.');
  // Lookup first; never replace or delete an existing database or bucket.
  const buckets=await api('r2/buckets');
  if(!(buckets.buckets??[]).some(item=>item.name===bucketName))await api('r2/buckets','POST',{name:bucketName});
  config.d1_databases[0].database_id=database.uuid;
  config.account_id=account;
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
  console.log(`Configured D1 ${databaseName} and R2 ${bucketName}. Run npm run db:remote, then npm run deploy.`);
}catch(error){console.error(error instanceof Error?error.message:'Cloudflare setup failed.');process.exit(1);}
