import { parseHTML } from 'linkedom';
import type { Env, StoredCapture } from './types';
import { htmlEscape } from './pages';

export function articleMarkdown(stored:StoredCapture):string {
  const {document}=parseHTML(`<html><body>${stored.article.content}</body></html>`);
  function render(node:Node):string {
    if(node.nodeType===3)return (node.textContent ?? '').replace(/([\\`*_\[\]])/g,'\\$1');
    if(node.nodeType!==1)return '';
    const element=node as Element;const tag=element.localName;
    const children=[...node.childNodes].map(render).join('');
    if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+children+'\n\n';
    if(tag==='p' || tag==='div' || tag==='section' || tag==='article')return '\n\n'+children+'\n\n';
    if(tag==='br')return '\n';
    if(tag==='strong'||tag==='b')return '**'+children+'**';
    if(tag==='em'||tag==='i')return '*'+children+'*';
    if(tag==='li')return '\n- '+children;
    if(tag==='blockquote')return '\n\n'+children.trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n';
    if(tag==='pre')return '\n\n```\n'+(element.textContent ?? '')+'\n```\n\n';
    if(tag==='code')return '`'+(element.textContent ?? '').replace(/`/g,'\\`')+'`';
    if(tag==='a')return element.getAttribute('href') ? '['+children+']('+element.getAttribute('href')?.replace(/\)/g,'%29')+')' : children;
    if(tag==='img')return '!['+(element.getAttribute('alt') ?? '').replace(/\]/g,'\\]')+']('+element.getAttribute('src')+')';
    if(tag==='hr')return '\n\n---\n\n';
    return children;
  }
  return `# ${stored.article.title}\n\n${stored.article.byline ? stored.article.byline+'\n\n' : ''}Source: ${stored.snapshot.url}\n\nCaptured: ${stored.snapshot.capturedAt}\n\n`+[...document.body.childNodes].map(render).join('').replace(/\n{3,}/g,'\n\n').trim()+'\n';
}
export async function exportHtml(stored:StoredCapture,env:Env):Promise<string> {
  let content=stored.article.content;
  for(const key of stored.mediaKeys ?? []){
    const object=await env.ARCHIVE.get(key);if(!object)continue;
    const bytes=new Uint8Array(await object.arrayBuffer());
    let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    const data=`data:${object.httpMetadata?.contentType ?? 'image/jpeg'};base64,${btoa(binary)}`;
    content=content.split('/'+key).join(data);
  }
  return `<!doctype html><html lang="${htmlEscape(stored.article.language)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${htmlEscape(stored.article.title)}</title><style>body{max-width:760px;margin:48px auto;padding:0 24px;background:#faf7f0;color:#222;font:20px/1.7 Georgia,serif}h1{line-height:1.15}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%;overflow:auto;display:block}a{color:#a22}header{border-bottom:1px solid #ccc;margin-bottom:2em}small{font:14px/1.6 system-ui}</style><header><h1>${htmlEscape(stored.article.title)}</h1><p>${htmlEscape(stored.article.byline ?? stored.article.siteName)}</p><small>Source: <a href="${htmlEscape(stored.snapshot.url)}">${htmlEscape(stored.snapshot.url)}</a><br>Captured ${htmlEscape(stored.snapshot.capturedAt)} · ${stored.snapshot.wordCount} words · ${htmlEscape(stored.snapshot.quality)} capture<br>SHA-256 ${htmlEscape(stored.snapshot.contentHash)}</small>${stored.article.warnings.length ? '<p><small>'+stored.article.warnings.map(htmlEscape).join('<br>')+'</small></p>' : ''}</header><main>${content}</main></html>`;
}
