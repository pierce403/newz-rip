import type { Env, StoredCapture } from './types';
import { AppError, normalizeUrl, validateTarget } from './url';
import { CaptureError, fetchArticle } from './fetcher';
import { extractArticle } from './extract';
import { deleteSnapshot, getSnapshot, latestSnapshot, listSnapshots, saveCapture } from './storage';
import { authorizeArchive, authorizeCapture, bearer, parseJsonBody, rateLimit, secureResponse, tokenMatches } from './security';
import { renderArchive, renderError, renderHome, renderLoading, renderNotFound, renderSnapshot } from './pages';
import { articleMarkdown, exportHtml } from './export';

function html(content:string,status=200):Response { return new Response(content,{status,headers:{'content-type':'text/html; charset=utf-8'}}); }
function apiCapture(stored:StoredCapture,cached:boolean):Response {
  return Response.json({snapshot:stored.snapshot,article:stored.article,attempts:stored.attempts,cached});
}
function pageNumber(value:string|null):number {const page=Number(value);return Number.isInteger(page)&&page>0 ? Math.min(page,10000):1;}

async function route(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
  const url=new URL(request.url);const path=url.pathname;const appName=env.APP_NAME ?? 'newz.rip';
  const read=request.method==='GET'||request.method==='HEAD';
  if(read && path==='/api/health') {
    const ready=await env.DB.prepare("SELECT count(*) AS count FROM snapshots WHERE source IN ('fetch','import')").first<{count:number}>();
    return Response.json({ok:!!ready,archive:env.ARCHIVE_PUBLIC!=='false'?'public':'private',captureProtected:!!env.CAPTURE_TOKEN,browser:env.ALLOW_BROWSER_RENDERING==='true'&&!!env.BROWSER});
  }
  if(read && path==='/') {
    const target=url.searchParams.get('url');
    return html(target?renderLoading(normalizeUrl(target),appName):renderHome(appName));
  }
  if(read && path==='/share') {
    const candidate=url.searchParams.get('url') || url.searchParams.get('text') || url.searchParams.get('title') || '';
    const target=candidate.match(/https?:\/\/[^\s<>]+/i)?.[0] ?? candidate;
    return html(renderLoading(normalizeUrl(target),appName));
  }
  if(read && path==='/read') return html(renderLoading(normalizeUrl(url.searchParams.get('url') ?? ''),appName));
  if(read && /^\/https?(?::|%3a)/i.test(path)) {
    const raw=path.slice(1)+url.search;
    const target=/^https?%3a/i.test(raw)?decodeURIComponent(raw):raw;
    return html(renderLoading(normalizeUrl(target),appName));
  }
  if(read && path==='/archive') {
    await authorizeArchive(request,env);
    const q=(url.searchParams.get('q') ?? '').slice(0,200);const page=pageNumber(url.searchParams.get('page'));
    const snapshots=await listSnapshots(env,{q,page,limit:21,offset:(page-1)*20});
    return html(renderArchive(snapshots.slice(0,20),q,page,snapshots.length>20,appName));
  }
  if(read && path==='/api/snapshots') {
    await authorizeArchive(request,env);
    const snapshots=await listSnapshots(env,{q:(url.searchParams.get('q')??'').slice(0,200),url:url.searchParams.get('url')??undefined,page:pageNumber(url.searchParams.get('page')),limit:20});
    return Response.json({snapshots,page:pageNumber(url.searchParams.get('page'))});
  }
  const snapshotPath=path.match(/^\/(?:s|api\/snapshots)\/([a-f0-9]{24})(\/download)?$/);
  if(read && snapshotPath) {
    await authorizeArchive(request,env);
    const stored=await getSnapshot(env,snapshotPath[1]);
    if(!stored)return path.startsWith('/api/')?Response.json({error:'Snapshot not found.',code:'not_found'},{status:404}):html(renderNotFound(appName),404);
    if(snapshotPath[2]) {
      const format=url.searchParams.get('format')??'html';
      const filename=stored.article.title.replace(/[^a-z0-9_-]+/gi,'-').slice(0,80)||'article';
      let body:string;let contentType:string;let extension:string;
      if(format==='json'){const {rawHtml:_raw,...safeExport}=stored;body=JSON.stringify(safeExport,null,2);contentType='application/json';extension='json';}
      else if(format==='md'){body=articleMarkdown(stored);contentType='text/markdown; charset=utf-8';extension='md';}
      else if(format==='txt'){body=`${stored.article.title}\n${stored.article.byline ?? stored.article.siteName}\n${stored.snapshot.url}\nCaptured ${stored.snapshot.capturedAt}\n\n${stored.article.textContent}\n`;contentType='text/plain; charset=utf-8';extension='txt';}
      else if(format==='html'){body=await exportHtml(stored,env);contentType='text/html; charset=utf-8';extension='html';}
      else throw new AppError('Choose html, json, md, or txt for the export.');
      return new Response(body,{headers:{'content-type':contentType,'content-disposition':`attachment; filename="${filename}.${extension}"`}});
    }
    if(path.startsWith('/api/'))return apiCapture(stored,true);
    const history=await listSnapshots(env,{url:stored.snapshot.canonicalUrl,limit:20});
    return html(renderSnapshot(stored,history,appName));
  }
  const mediaPath=path.match(/^\/media\/([a-f0-9]{24})\/([0-3])$/);
  if(read && mediaPath) {
    await authorizeArchive(request,env);
    const stored=await getSnapshot(env,mediaPath[1]);const key=path.slice(1);
    if(!stored?.mediaKeys?.includes(key))throw new AppError('Image not found.',404,'not_found');
    const object=await env.ARCHIVE.get(key);if(!object)throw new AppError('Image not found.',404,'not_found');
    const headers=new Headers({'content-type':object.httpMetadata?.contentType??'application/octet-stream','etag':object.httpEtag,'cache-control':env.ARCHIVE_PUBLIC==='false'?'private, no-store':'public, max-age=31536000, immutable'});
    if(request.headers.get('if-none-match')===object.httpEtag)return new Response(null,{status:304,headers});
    return new Response(object.body,{headers});
  }
  if(request.method==='POST' && (path==='/api/capture'||path==='/api/import')) {
    await authorizeCapture(request,env);await rateLimit(request,env);
    const input=await parseJsonBody(request);
    if(typeof input.url!=='string')throw new AppError('Enter the article URL.');
    const target=normalizeUrl(input.url);
    if(input.refresh!==undefined && typeof input.refresh!=='boolean')throw new AppError('refresh must be a boolean.');
    if(path==='/api/capture' && input.refresh!==true) {
      const existing=await latestSnapshot(env,target);
      if(existing && Date.now()-Date.parse(existing.snapshot.capturedAt)<3600000)return apiCapture(existing,true);
    }
    let capture;
    if(path==='/api/import') {
      if(typeof input.html!=='string'||new TextEncoder().encode(input.html).byteLength>2*1024*1024)throw new AppError('Choose a saved HTML page smaller than 2 MB.',413,'too_large');
      const article=extractArticle(input.html,target);
      if(!article)throw new AppError('The saved page does not contain a readable article.',422,'empty_article');
      article.url=target;article.warnings.push('This snapshot was imported from a saved HTML file; it was not fetched directly from the publisher.');
      capture={article,rawHtml:input.html,attempts:[{strategy:'import',url:target,status:article.quality==='full'?'success' as const:'partial' as const,message:'Imported a saved HTML page.',durationMs:0}]};
    }else capture=await fetchArticle(target,env);
    const {stored,cached}=await saveCapture(env,capture);
    ctx.waitUntil(env.DB.prepare('DELETE FROM rate_limits WHERE window_start<?').bind(Math.floor(Date.now()/1000)-86400).run().catch(()=>{}));
    return apiCapture(stored,cached);
  }
  const deletePath=path.match(/^\/api\/snapshots\/([a-f0-9]{24})$/);
  if(request.method==='DELETE'&&deletePath) {
    const origin=request.headers.get('origin');if(origin&&origin!==url.origin)throw new AppError('Cross-site deletion is not allowed.',403,'forbidden');
    if(!env.ADMIN_TOKEN||!await tokenMatches(bearer(request),env.ADMIN_TOKEN))throw new AppError('An administrator token is required.',401,'unauthorized');
    const deleted=await deleteSnapshot(env,deletePath[1]);return Response.json({deleted},{status:deleted?200:404});
  }
  if(!read)return Response.json({error:'Method not allowed.',code:'method_not_allowed'},{status:405,headers:{allow:'GET, HEAD'}});
  if(env.ASSETS && ['/styles.css','/app.js','/favicon.svg','/robots.txt','/manifest.webmanifest'].includes(path))return env.ASSETS.fetch(request);
  return path.startsWith('/api/')?Response.json({error:'Not found.',code:'not_found'},{status:404}):html(renderNotFound(appName),404);
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
    let response:Response;
    try {response=await route(request,env,ctx);}
    catch(error) {
      const known=error instanceof AppError;
      const status=known?error.status:503;
      const message=known?error.message:'The archive is temporarily unavailable. Please try again shortly.';
      const payload={error:message,code:known?error.code:'server_error',...(error instanceof CaptureError?{attempts:error.attempts}:{})};
      response=new URL(request.url).pathname.startsWith('/api/')?Response.json(payload,{status}):html(renderError(message,status,new URL(request.url).searchParams.get('url')??'',env.APP_NAME),status);
    }
    const secured=secureResponse(response);
    return request.method==='HEAD'?new Response(null,{status:secured.status,headers:secured.headers}):secured;
  }
};
