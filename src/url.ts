import { isIP } from 'node:net';

export class AppError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid_request') { super(message); }
}

/** Only public DNS names, HTTP(S), and standard web ports. WHATWG normalizes numeric IP tricks. */
export function validateTarget(input: string): URL {
  if (typeof input !== 'string' || input.length > 4096) throw new AppError('Enter a valid article URL.');
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new AppError('Enter a full URL starting with https://.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('Only HTTP and HTTPS links are supported.');
  if (url.username || url.password) throw new AppError('URLs containing credentials are not allowed.');
  if (url.port && !['80', '443'].includes(url.port)) throw new AppError('Only standard web ports are supported.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host.replace(/^\[|\]$/g, '')) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(host)) {
    throw new AppError('Use a public website hostname, not an IP address or local name.');
  }
  if (/(?:^|\.)(?:localhost|local|internal|intranet|home|lan|arpa|onion|invalid|test|example)$/.test(host)) throw new AppError('Local and reserved hostnames are not allowed.');
  url.hostname = host;
  url.hash = '';
  return url;
}

export function normalizeUrl(input: string): string {
  const url = validateTarget(input);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|igshid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

export function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (version === 6) {
    const canonical = new URL('http://[' + address + ']/').hostname.slice(1, -1);
    const first = parseInt(canonical.split(':')[0], 16);
    const second = parseInt(canonical.split(':')[1] || '0', 16);
    // Global unicast only; exclude documentation, transition, benchmark and special-purpose ranges.
    return first >= 0x2000 && first <= 0x3fff
      && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
      && first !== 0x2002 && first !== 0x3fff;
  }
  return false;
}

export async function assertPublicDns(url: URL, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<void> {
  const responses = await Promise.all([1,28].map(async type => {
    const query = new URL('https://cloudflare-dns.com/dns-query');
    query.searchParams.set('name', url.hostname); query.searchParams.set('type', String(type));
    const response = await fetcher(query, { headers: { Accept: 'application/dns-json' }, redirect: 'manual', signal });
    if (!response.ok) throw new AppError('DNS validation is temporarily unavailable. Try again shortly.', 502, 'dns_failed');
    const text = await response.text();
    if (text.length > 65536) throw new AppError('Invalid DNS response.', 502, 'dns_failed');
    return JSON.parse(text) as { Status: number; Answer?: { type: number; data: string }[] };
  }));
  const addresses = responses.flatMap(result => (result.Answer ?? []).filter(answer => answer.type === 1 || answer.type === 28).map(answer => answer.data));
  if (responses.some(r => ![0,3].includes(r.Status)) || !addresses.length) throw new AppError('The website hostname could not be resolved.', 502, 'dns_failed');
  if (addresses.some(address => !isPublicIp(address))) throw new AppError('The website resolves to a private or reserved address.', 400, 'unsafe_target');
}
