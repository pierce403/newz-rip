import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse, Request as RuntimeRequest } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

let worker:Miniflare;
let snapshotId:string;
const sourceHtml=(tail='')=>`<!doctype html><html><head><title>Example local news story</title><meta property="og:site_name" content="Example News"><meta name="author" content="Test Reporter"></head><body><article><h1>Example local news story</h1>${Array.from({length:12},(_,i)=>`<p>Local reporters confirmed the important community development after extensive interviews with residents and officials. The detailed report describes new findings, provides historical context and explains how the changes will affect daily life for readers in the region. This is paragraph number ${i} in the full article.</p>`).join('')}<p>${tail}</p><script>alert('danger')</script><img src="javascript:alert(1)" onerror="alert(2)"></article></body></html>`;
async function call(path:string,init?:Parameters<Miniflare['dispatchFetch']>[1]){return worker.dispatchFetch('https://newz.example.com'+path,init);}
async function save(extra:Record<string,unknown>={}){
  return call('/api/import',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'203.0.113.55'},body:JSON.stringify({url:'https://example.com/local-story',html:sourceHtml(),...extra})});
}

beforeAll(async()=>{
  await build({entryPoints:['web/app.ts'],bundle:true,format:'esm',outfile:'public/app.js'});
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir','.wrangler/test-build'],{env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'pipe'});
  worker=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/test-build/index.js',compatibilityDate:'2026-08-06',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'test-db'},r2Buckets:{ARCHIVE:'test-archive'},bindings:{APP_NAME:'newz.rip',ARCHIVE_IMAGES:'false',ALLOW_WAYBACK:'false'},outboundService:async (request:RuntimeRequest)=>{
    const url=new URL(request.url);
    if(url.hostname==='cloudflare-dns.com')return RuntimeResponse.json({Status:0,Answer:[{type:1,data:'8.8.8.8'}]});
    if(url.hostname==='news.example.com')return new RuntimeResponse(sourceHtml(),{headers:{'content-type':'text/html; charset=utf-8'}});
    return new RuntimeResponse('Unexpected outbound request',{status:502});
  }}));
  const db=await worker.getD1Database('DB');
  const migration=readdirSync('migrations').filter(p=>p.endsWith('.sql')).sort().map(p=>readFileSync('migrations/'+p,'utf8')).join('\n');
  for(const statement of migration.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
},60000);
afterAll(async()=>{await worker?.dispose();});

describe('real Workers + D1 + R2 archive',()=>{
  it('serves the home page with strict headers and validates health',async()=>{
    const response=await call('/');expect(response.status).toBe(200);expect(await response.text()).toContain('Save a page');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    const health=await call('/api/health');expect((await health.json() as {ok:boolean}).ok).toBe(true);
  });
  it('imports, sanitizes, stores and retrieves a durable snapshot',async()=>{
    const response=await save();expect(response.status).toBe(200);
    const result=await response.json() as {snapshot:{id:string;wordCount:number};article:{content:string};cached:boolean};
    snapshotId=result.snapshot.id;expect(snapshotId).toMatch(/^[a-f0-9]{24}$/);expect(result.snapshot.wordCount).toBeGreaterThan(300);
    expect(result.article.content).not.toMatch(/script|onerror|javascript:/);expect(result.cached).toBe(false);
    const saved=await call('/s/'+snapshotId);expect(saved.status).toBe(200);expect(await saved.text()).toContain('Example local news story');
    const bucket=await worker.getR2Bucket('ARCHIVE');expect(await bucket.head(`snapshots/${snapshotId}.json`)).not.toBeNull();
  });
  it('uses supported Workers redirects for real outbound DNS/article fetches and avoids imported cache poisoning',async()=>{
    const imported=await save({url:'https://news.example.com/story',html:sourceHtml().replaceAll('Example local news story','Forged imported headline')});
    expect(imported.status).toBe(200);
    const response=await call('/api/capture',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'203.0.113.66'},body:JSON.stringify({url:'https://news.example.com/story'})});
    expect(response.status).toBe(200);
    const result=await response.json() as {snapshot:{source:string};article:{title:string};attempts:{strategy:string}[]};
    expect(result.snapshot.source).toBe('fetch');expect(result.article.title).toBe('Example local news story');expect(result.attempts[0].strategy).toBe('googlebot');
  });
  it('does not let cross-origin canonical metadata claim another publisher URL',async()=>{
    const response=await save({url:'https://evil.example.com/forged',html:sourceHtml().replace('</head>','<link rel="canonical" href="https://www.nytimes.com/real-story"></head>')});
    expect(response.status).toBe(200);const result=await response.json() as {snapshot:{canonicalUrl:string}};
    expect(result.snapshot.canonicalUrl).toBe('https://evil.example.com/forged');
  });
  it('deduplicates an identical body while preserving the first timestamp',async()=>{
    const first=await call('/api/snapshots/'+snapshotId);const original=await first.json() as {snapshot:{capturedAt:string}};
    const repeated=await save();const result=await repeated.json() as {snapshot:{id:string;capturedAt:string};cached:boolean};
    expect(result.cached).toBe(true);expect(result.snapshot.id).toBe(snapshotId);expect(result.snapshot.capturedAt).toBe(original.snapshot.capturedAt);
  });
  it('creates a new version for changed content and supports history and full text search',async()=>{
    const changed=await save({html:sourceHtml('Unique quasar telescope discovery added to this later edition.')});expect(changed.status).toBe(200);
    const result=await changed.json() as {snapshot:{id:string}};expect(result.snapshot.id).not.toBe(snapshotId);
    const versions=await call('/api/snapshots?url='+encodeURIComponent('https://example.com/local-story'));expect((await versions.json() as {snapshots:unknown[]}).snapshots).toHaveLength(2);
    const search=await call('/api/snapshots?q=quasar');expect((await search.json() as {snapshots:unknown[]}).snapshots).toHaveLength(1);
    const urlSearch=await call('/api/snapshots?q='+encodeURIComponent('example.com/local-story'));expect((await urlSearch.json() as {snapshots:unknown[]}).snapshots).toHaveLength(2);
    const punctuation=await call('/api/snapshots?q='+encodeURIComponent('" OR *'));expect(punctuation.status).toBe(200);
  });
  it.each(['html','json','md','txt'])('exports %s without executing archived source',async format=>{
    const response=await call(`/s/${snapshotId}/download?format=${format}`);expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');const text=await response.text();expect(text).toContain('Example local news story');
    if(format==='html'||format==='json')expect(text).not.toContain("alert('danger')");
    if(format==='json')expect(JSON.parse(text)).not.toHaveProperty('rawHtml');
  });
  it('rejects private URLs, malformed JSON, bad content types and cross-origin writes',async()=>{
    expect((await save({url:'http://127.0.0.1/'})).status).toBe(400);
    expect((await call('/api/import',{method:'POST',headers:{'content-type':'application/json'},body:'{bad'})).status).toBe(400);
    expect((await call('/api/import',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'})).status).toBe(415);
    expect((await call('/api/import',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example.com'},body:'{}'})).status).toBe(403);
  });
  it('returns real 404s and does not permit unauthenticated deletion',async()=>{
    expect((await call('/s/'+ 'f'.repeat(24))).status).toBe(404);
    expect((await call('/api/snapshots/'+snapshotId,{method:'DELETE'})).status).toBe(401);
    const head=await call('/s/'+snapshotId,{method:'HEAD'});expect(head.status).toBe(200);expect(await head.text()).toBe('');
  });
  it('enforces the per-minute capture limit even for invalid inputs',async()=>{
    for(let index=0;index<10;index++){
      const response=await call('/api/import',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'203.0.113.77'},body:'{}'});
      expect(response.status).toBe(400);
    }
    const response=await call('/api/import',{method:'POST',headers:{'content-type':'application/json','CF-Connecting-IP':'203.0.113.77'},body:'{}'});
    expect(response.status).toBe(429);
  });
  it('protects capture, private API reads, and administrator deletion',async()=>{
    const protectedWorker=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.wrangler/test-build/index.js',compatibilityDate:'2026-08-06',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'protected-db'},r2Buckets:{ARCHIVE:'protected-archive'},bindings:{ARCHIVE_IMAGES:'false',CAPTURE_TOKEN:'capture-test-token',ADMIN_TOKEN:'admin-test-token',ARCHIVE_PUBLIC:'false'}}));
    try {
      const db=await protectedWorker.getD1Database('DB');
      for(const statement of readdirSync('migrations').filter(p=>p.endsWith('.sql')).sort().map(p=>readFileSync('migrations/'+p,'utf8')).join('\n').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
      const endpoint='https://private.example.com';
      expect((await protectedWorker.dispatchFetch(endpoint+'/api/import',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401);
      expect((await protectedWorker.dispatchFetch(endpoint+'/api/capture',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer capture-test-token'},body:JSON.stringify({url:'https://example.com/private-story'})})).status).toBe(401);
      const saved=await protectedWorker.dispatchFetch(endpoint+'/api/import',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer admin-test-token'},body:JSON.stringify({url:'https://example.com/private-story',html:sourceHtml()})});
      expect(saved.status).toBe(200);const {snapshot}=await saved.json() as {snapshot:{id:string;objectKey:string}};
      expect((await protectedWorker.dispatchFetch(endpoint+'/api/snapshots/'+snapshot.id)).status).toBe(401);
      expect((await protectedWorker.dispatchFetch(endpoint+'/api/snapshots/'+snapshot.id,{headers:{Authorization:'Bearer admin-test-token'}})).status).toBe(200);
      expect((await protectedWorker.dispatchFetch(endpoint+'/api/snapshots/'+snapshot.id,{method:'DELETE',headers:{Authorization:'Bearer capture-test-token'}})).status).toBe(401);
      expect((await protectedWorker.dispatchFetch(endpoint+'/api/snapshots/'+snapshot.id,{method:'DELETE',headers:{Authorization:'Bearer admin-test-token'}})).status).toBe(200);
      expect(await (await protectedWorker.getR2Bucket('ARCHIVE')).head(snapshot.objectKey)).toBeNull();
      const retryId='d'.repeat(24);const retryKey='snapshots/'+retryId+'.json';
      const bucket=await protectedWorker.getR2Bucket('ARCHIVE');await bucket.put(retryKey,'orphaned payload');
      await db.prepare('INSERT INTO pending_deletions(id,object_keys,created_at) VALUES(?,?,?)').bind(retryId,JSON.stringify([retryKey]),new Date().toISOString()).run();
      expect((await protectedWorker.dispatchFetch(endpoint+'/api/snapshots/'+retryId,{method:'DELETE',headers:{Authorization:'Bearer admin-test-token'}})).status).toBe(200);
      expect(await bucket.head(retryKey)).toBeNull();
      expect(await db.prepare('SELECT id FROM pending_deletions WHERE id=?').bind(retryId).first()).toBeNull();
    }finally{await protectedWorker.dispose();}
  });
  it('supports prefixed links and shared text',async()=>{
    expect((await call('/https://example.com/story')).status).toBe(200);
    const shared=await call('/share?text='+encodeURIComponent('Read this https://example.com/story'));expect(shared.status).toBe(200);expect(await shared.text()).toContain('data-url="https://example.com/story"');
  });
});
