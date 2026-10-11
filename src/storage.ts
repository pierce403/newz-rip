import type { Article, CaptureResult, Env, Snapshot, StoredCapture } from './types';
import { AppError, normalizeUrl } from './url';
import { archiveImages } from './images';

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
}
interface Row {
  id: string; url: string; canonical_url: string; title: string; site_name: string; byline: string|null;
  captured_at: string; published_at: string|null; content_hash: string; word_count: number;
  quality: Article['quality']; extraction_method: Article['extractionMethod']; object_key: string;
}
function fromRow(row: Row): Snapshot {
  return { id: row.id, url: row.url, canonicalUrl: row.canonical_url, title: row.title, siteName: row.site_name,
    byline: row.byline, capturedAt: row.captured_at, publishedAt: row.published_at, contentHash: row.content_hash,
    wordCount: row.word_count, quality: row.quality, extractionMethod: row.extraction_method, objectKey: row.object_key };
}
export async function getSnapshot(env: Env, id: string): Promise<StoredCapture|null> {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  const row = await env.DB.prepare('SELECT * FROM snapshots WHERE id=?').bind(id).first<Row>();
  if (!row) return null;
  const object = await env.ARCHIVE.get(row.object_key);
  if (!object) throw new AppError('This snapshot is temporarily unavailable.',503,'storage_unavailable');
  const stored = await object.json<StoredCapture>();
  stored.snapshot = fromRow(row);
  return stored;
}
export async function latestSnapshot(env: Env, url: string): Promise<StoredCapture|null> {
  const row = await env.DB.prepare('SELECT id FROM snapshots WHERE url=? OR canonical_url=? ORDER BY captured_at DESC LIMIT 1').bind(url,url).first<{id:string}>();
  return row ? getSnapshot(env,row.id) : null;
}
export async function listSnapshots(env: Env, options: {url?:string;q?:string;page?:number;limit?:number;offset?:number} = {}): Promise<Snapshot[]> {
  const limit = Math.max(1,Math.min(options.limit ?? 20,100));
  const offset = options.offset ?? Math.max(0,(options.page ?? 1)-1)*limit;
  let statement: D1PreparedStatement;
  if (options.url) {
    const url = normalizeUrl(options.url);
    statement = env.DB.prepare('SELECT * FROM snapshots WHERE url=? OR canonical_url=? ORDER BY captured_at DESC LIMIT ? OFFSET ?').bind(url,url,limit,offset);
  } else if (options.q?.trim()) {
    // Quoted FTS tokens, so punctuation cannot turn into an FTS expression or invalid query.
    const tokens = options.q.match(/[\p{L}\p{N}_-]+/gu)?.slice(0,12) ?? [];
    if (!tokens.length) return [];
    const query = tokens.map(t => '"' + t.replace(/"/g,'""') + '"*').join(' AND ');
    statement = env.DB.prepare('SELECT s.* FROM snapshots s JOIN snapshots_fts f ON s.rowid=f.rowid WHERE snapshots_fts MATCH ? ORDER BY s.captured_at DESC LIMIT ? OFFSET ?').bind(query,limit,offset);
  } else statement = env.DB.prepare('SELECT * FROM snapshots ORDER BY captured_at DESC LIMIT ? OFFSET ?').bind(limit,offset);
  const rows = await statement.all<Row>();
  return (rows.results ?? []).map(fromRow);
}

export async function saveCapture(env: Env, capture: CaptureResult): Promise<{stored:StoredCapture;cached:boolean}> {
  let canonical: string;
  try { canonical = normalizeUrl(capture.article.canonicalUrl); } catch { canonical = normalizeUrl(capture.article.url); }
  const article = { ...capture.article, canonicalUrl: canonical };
  const hash = await sha256(JSON.stringify({title:article.title,byline:article.byline,publishedAt:article.publishedAt,content:article.content}));
  const previous = await env.DB.prepare('SELECT id FROM snapshots WHERE canonical_url=? AND content_hash=?').bind(canonical,hash).first<{id:string}>();
  if (previous) {
    const stored = await getSnapshot(env,previous.id);
    if (stored) return {stored,cached:true};
  }
  // Unique capture IDs avoid overwriting objects in concurrent captures. The DB winner is immutable.
  const id = crypto.randomUUID().replace(/-/g,'').slice(0,24);
  const objectKey = `snapshots/${id}.json`;
  const snapshot: Snapshot = {
    id, url: article.url, canonicalUrl: canonical, title:article.title, siteName:article.siteName, byline:article.byline,
    capturedAt:new Date().toISOString(), publishedAt:article.publishedAt, contentHash:hash, wordCount:article.wordCount,
    quality:article.quality, extractionMethod:article.extractionMethod, objectKey
  };
  const archived = await archiveImages(article,id,env);
  const stored: StoredCapture = {...capture,article:archived.article,snapshot,mediaKeys:archived.keys};
  await env.ARCHIVE.put(objectKey,JSON.stringify(stored),{httpMetadata:{contentType:'application/json'}});
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO snapshots(id,url,canonical_url,title,site_name,byline,captured_at,published_at,content_hash,word_count,quality,extraction_method,object_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id,article.url,canonical,article.title,article.siteName,article.byline,snapshot.capturedAt,article.publishedAt,hash,article.wordCount,article.quality,article.extractionMethod,objectKey),
      env.DB.prepare("INSERT INTO snapshots_fts(rowid,title,site_name,excerpt,url) SELECT rowid,title,site_name,?,url || ' ' || canonical_url FROM snapshots WHERE id=?").bind(article.textContent,id)
    ]);
  } catch (error) { await env.ARCHIVE.delete([objectKey,...stored.mediaKeys ?? []]).catch(()=>{}); throw error; }
  const winner = await env.DB.prepare('SELECT id FROM snapshots WHERE canonical_url=? AND content_hash=?').bind(canonical,hash).first<{id:string}>();
  if (winner && winner.id !== id) {
    await env.ARCHIVE.delete([objectKey,...stored.mediaKeys ?? []]);
    const existing = await getSnapshot(env,winner.id);
    if (existing) return {stored:existing,cached:true};
  }
  return {stored,cached:false};
}

export async function deleteSnapshot(env:Env,id:string):Promise<boolean> {
  if (!/^[a-f0-9]{24}$/.test(id)) return false;
  const row = await env.DB.prepare('SELECT object_key FROM snapshots WHERE id=?').bind(id).first<{object_key:string}>();
  if (!row) return false;
  const stored=await getSnapshot(env,id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM snapshots_fts WHERE rowid=(SELECT rowid FROM snapshots WHERE id=?)').bind(id),
    env.DB.prepare('DELETE FROM snapshots WHERE id=?').bind(id)
  ]);
  await env.ARCHIVE.delete([row.object_key,...stored?.mediaKeys ?? []]);
  return true;
}
