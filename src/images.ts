import { parseHTML } from 'linkedom';
import { assertPublicDns, validateTarget } from './url';
import type { Article, Env } from './types';

const MAX_IMAGE = 768 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
async function imageBytes(input:string,signal:AbortSignal):Promise<{bytes:Uint8Array;contentType:string}|null> {
  let url = validateTarget(input);
  for(let hop=0;hop<=3;hop++) {
    await assertPublicDns(url,fetch,signal);
    const response=await fetch(url,{redirect:'manual',signal,headers:{Accept:'image/avif,image/webp,image/png,image/jpeg,image/gif'}});
    if([301,302,303,307,308].includes(response.status)) {
      const next=response.headers.get('location');await response.body?.cancel();
      if(!next || hop===3) return null;
      url=validateTarget(new URL(next,url).href);continue;
    }
    const contentType=(response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
    if(!response.ok || !ALLOWED_TYPES.has(contentType) || Number(response.headers.get('content-length') ?? 0)>MAX_IMAGE){await response.body?.cancel();return null;}
    const reader=response.body?.getReader();if(!reader)return null;
    let size=0;const chunks:Uint8Array[]=[];
    try {
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_IMAGE)return null;chunks.push(value);}
    }finally{await reader.cancel().catch(()=>{});}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    // Check magic bytes as well as MIME; never preserve SVG or HTML disguised as a raster image.
    const hex=[...bytes.slice(0,12)].map(b=>b.toString(16).padStart(2,'0')).join('');
    const signature = contentType==='image/jpeg' ? hex.startsWith('ffd8ff')
      : contentType==='image/png' ? hex.startsWith('89504e470d0a1a0a')
      : contentType==='image/gif' ? /^474946383[79]61/.test(hex)
      : contentType==='image/webp' ? hex.startsWith('52494646') && hex.slice(16)==='57454250'
      : hex.slice(8).startsWith('6674797061766966') || hex.slice(8).startsWith('6674797061766973');
    if(!signature)return null;
    return {bytes,contentType};
  }
  return null;
}
export async function archiveImages(article:Article,id:string,env:Env):Promise<{article:Article;keys:string[]}> {
  if(env.ARCHIVE_IMAGES === 'false') return {article,keys:[]};
  const {document}=parseHTML(`<html><body>${article.content}</body></html>`);
  const allSources=[...new Set([article.image,...[...document.querySelectorAll('img')].map(e=>e.getAttribute('src'))].filter((x):x is string=>!!x))];
  const sources=allSources.slice(0,4);
  const saved=new Map<string,string>();const keys:string[]=[];const signal=AbortSignal.timeout(7000);
  for(let i=0;i<sources.length;i++) {
    if(signal.aborted)break;
    try {
      const result=await imageBytes(sources[i],signal);if(!result)continue;
      const key=`media/${id}/${i}`;
      await env.ARCHIVE.put(key,result.bytes,{httpMetadata:{contentType:result.contentType}});
      saved.set(sources[i],`/media/${id}/${i}`);keys.push(key);
    }catch{/* Preserve text even if the publisher image cannot be captured. */}
  }
  for(const image of document.querySelectorAll('img')) {
    const source=image.getAttribute('src');if(source && saved.has(source))image.setAttribute('src',saved.get(source)!);
  }
  const missing=allSources.length-saved.size;
  return {article:{...article,content:document.body.innerHTML,image:article.image ? saved.get(article.image) ?? article.image : null,
    warnings:missing ? [...article.warnings,`${missing} image${missing===1?' was':'s were'} not saved; those image links still depend on the publisher.`] : article.warnings},keys};
}
