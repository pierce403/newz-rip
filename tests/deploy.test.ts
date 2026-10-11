import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function workspace():string {
  const path=mkdtempSync(join(tmpdir(),'newz-setup-'));mkdirSync(join(path,'scripts'));
  copyFileSync('scripts/setup-cloudflare.mjs',join(path,'scripts/setup-cloudflare.mjs'));
  copyFileSync('scripts/deploy.mjs',join(path,'scripts/deploy.mjs'));
  const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  config.d1_databases[0].database_id='00000000-0000-0000-0000-000000000000';
  writeFileSync(join(path,'wrangler.jsonc'),JSON.stringify(config));
  return path;
}
const account='a'.repeat(32);const uuid='12345678-1234-1234-1234-123456789abc';
describe('Cloudflare provisioning controls',()=>{
  it('does not provision resources without explicit secret environment',()=>{
    const path=workspace();try{
      const env={...process.env};delete env.CLOUDFLARE_API_TOKEN;delete env.CLOUDFLARE_ACCOUNT_ID;
      const result=spawnSync(process.execPath,['scripts/setup-cloudflare.mjs'],{cwd:path,env,encoding:'utf8'});
      expect(result.status).toBe(1);expect(result.stderr).toContain('Set CLOUDFLARE_ACCOUNT_ID');
      expect(readFileSync(join(path,'wrangler.jsonc'),'utf8')).toContain('00000000-0000-0000-0000-000000000000');
    }finally{rmSync(path,{recursive:true,force:true});}
  });
  it('reuses existing named resources and writes no API token',()=>{
    const path=workspace();try{
      writeFileSync(join(path,'mock.mjs'),`import {appendFileSync} from 'node:fs';globalThis.fetch=async(url,options)=>{appendFileSync('calls.txt',options.method+' '+url+'\\n');if(options.method!=='GET')throw new Error('Unexpected mutation');const result=String(url).includes('d1/database')?[{name:'newz-rip',uuid:'${uuid}'}]:{buckets:[{name:'newz-rip-archive'}]};return Response.json({success:true,result});};`);
      const result=spawnSync(process.execPath,['--import','./mock.mjs','scripts/setup-cloudflare.mjs'],{cwd:path,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'FAKE-TEST-SECRET'},encoding:'utf8'});
      expect(result.status).toBe(0);const config=readFileSync(join(path,'wrangler.jsonc'),'utf8');
      expect(config).toContain(uuid);expect(config).not.toContain('FAKE-TEST-SECRET');expect(result.stdout+result.stderr).not.toContain('FAKE-TEST-SECRET');
      expect(readFileSync(join(path,'calls.txt'),'utf8')).not.toMatch(/POST|DELETE|PUT/);
    }finally{rmSync(path,{recursive:true,force:true});}
  });
  it('fails deployment before publication when the D1 ID is a placeholder',()=>{
    const path=workspace();try{
      const result=spawnSync(process.execPath,['scripts/deploy.mjs'],{cwd:path,encoding:'utf8'});
      expect(result.status).toBe(1);expect(result.stderr).toContain('Configure a real D1 database ID');
    }finally{rmSync(path,{recursive:true,force:true});}
  });
  it('does not log raw authorization failures or secret request headers',()=>{
    const path=workspace();try{
      writeFileSync(join(path,'mock.mjs'),`globalThis.fetch=async()=>Response.json({success:false,errors:[{code:10000,message:'FAKE-TEST-SECRET raw error'}]},{status:403});`);
      const result=spawnSync(process.execPath,['--import','./mock.mjs','scripts/setup-cloudflare.mjs'],{cwd:path,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'FAKE-TEST-SECRET'},encoding:'utf8'});
      expect(result.status).toBe(1);expect(result.stderr).toContain('10000');expect(result.stderr).not.toContain('FAKE-TEST-SECRET');
    }finally{rmSync(path,{recursive:true,force:true});}
  });
});
