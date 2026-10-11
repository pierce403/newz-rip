import { describe, it, expect } from 'vitest';
import { validateTarget, normalizeUrl, isPublicIp, assertPublicDns } from '../src/url';
import { fetchPublicPage, readBounded } from '../src/fetcher';

describe('target protection', () => {
  it.each(['http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/', 'https://localhost/', 'https://metadata.google.internal/', 'file:///etc/passwd', 'https://user:pass@cnn.com/', 'https://cnn.com:8080/'])('rejects %s', url => expect(() => validateTarget(url)).toThrow());
  it('normalizes tracking without deleting article queries', () => expect(normalizeUrl('https://example.com/story?id=12&utm_source=x#foo')).toBe('https://example.com/story?id=12'));
  it.each(['127.0.0.1','10.0.0.1','100.64.0.1','172.16.0.1','192.168.1.1','169.254.169.254','198.18.0.1','203.0.113.2','::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::'])('rejects non-public address %s', ip => expect(isPublicIp(ip)).toBe(false));
  it.each(['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])('accepts public IP %s', ip => expect(isPublicIp(ip)).toBe(true));
  it('fails closed for a public name resolving to a private address', async () => {
    const mock = (async () => Response.json({Status:0,Answer:[{type:1,data:'10.0.0.1'}]})) as typeof fetch;
    await expect(assertPublicDns(new URL('https://cnn.com'),mock)).rejects.toThrow('private');
  });
  it('checks redirect targets before sending any second request', async () => {
    let count = 0;
    const mock = (async () => { count++; return new Response(null,{status:302,headers:{location:'http://169.254.169.254/'}}); }) as typeof fetch;
    await expect(fetchPublicPage('https://cnn.com','test',{fetcher:mock,verifyDns:false})).rejects.toThrow(); expect(count).toBe(1);
  });
  it('bounds chunked response sizes', async () => {
    const body = new ReadableStream({start(c){ c.enqueue(new Uint8Array(20)); c.close(); }});
    await expect(readBounded(new Response(body),10)).rejects.toThrow('large');
  });
});
