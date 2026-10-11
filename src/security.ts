import type { Env } from './types';
import { AppError } from './url';
import { sha256 } from './storage';
import { readBounded } from './fetcher';

export const SECURITY_HEADERS:Record<string,string> = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: http:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests",
  'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag':'noindex, nofollow, noarchive', 'Cross-Origin-Opener-Policy':'same-origin'
};
export function secureResponse(response:Response):Response {
  const headers = new Headers(response.headers);
  for (const [key,value] of Object.entries(SECURITY_HEADERS)) headers.set(key,value);
  if (!headers.has('cache-control')) headers.set('cache-control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function bearer(request:Request):string {
  return request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1] ?? '';
}
export async function tokenMatches(given:string,expected:string):Promise<boolean> {
  if (!given || !expected) return false;
  const [a,b] = await Promise.all([sha256(given),sha256(expected)]);
  let difference = 0; for (let i=0;i<a.length;i++) difference |= a.charCodeAt(i)^b.charCodeAt(i);
  return difference === 0;
}
export async function authorizeCapture(request:Request,env:Env):Promise<void> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new AppError('Cross-site capture requests are not allowed.',403,'forbidden');
  // Captures can return cached or deduplicated snapshots, so private archives
  // must apply their read policy before any capture/import response.
  if (env.ARCHIVE_PUBLIC === 'false') { await authorizeArchive(request,env); return; }
  if (env.CAPTURE_TOKEN && !await tokenMatches(bearer(request),env.CAPTURE_TOKEN)) throw new AppError('Enter the capture access token to save an article.',401,'unauthorized');
}
export async function authorizeArchive(request:Request,env:Env):Promise<void> {
  if (env.ARCHIVE_PUBLIC === 'false') {
    const expected = env.ADMIN_TOKEN ?? env.CAPTURE_TOKEN;
    if (!expected || !await tokenMatches(bearer(request),expected)) throw new AppError('This archive is private. An archive access token is required.',401,'unauthorized');
  }
}
export async function rateLimit(request:Request,env:Env):Promise<void> {
  const now = Math.floor(Date.now()/1000); const window = Math.floor(now/60)*60;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const key = (await sha256(ip)).slice(0,32);
  const row = await env.DB.prepare('INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END, window_start=excluded.window_start RETURNING count').bind(key,window).first<{count:number}>();
  if ((row?.count ?? 11) > 10) throw new AppError('Too many captures. Wait a minute and try again.',429,'rate_limited');
}
export async function parseJsonBody(request:Request):Promise<Record<string,unknown>> {
  if (!/application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AppError('Send JSON with Content-Type: application/json.',415,'invalid_content_type');
  const text = await readBounded(new Response(request.body,{headers:request.headers}),2*1024*1024+8192);
  try {
    const value=JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new AppError('The request is not valid JSON.'); }
}
