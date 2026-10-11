export interface Env {
  DB: D1Database;
  ARCHIVE: R2Bucket;
  ASSETS?: Fetcher;
  APP_NAME?: string;
  ARCHIVE_PUBLIC?: string;
  ADMIN_TOKEN?: string;
  CAPTURE_TOKEN?: string;
  ALLOW_WAYBACK?: string;
  ALLOW_BROWSER_RENDERING?: string;
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_TOKEN?: string;
}
export type ExtractionMethod = 'readability' | 'json-ld' | 'publisher' | 'embedded-state' | 'generic';
export interface Article {
  url: string;
  canonicalUrl: string;
  title: string;
  byline: string | null;
  siteName: string;
  excerpt: string;
  publishedAt: string | null;
  language: string;
  content: string;
  textContent: string;
  wordCount: number;
  readingMinutes: number;
  image: string | null;
  extractionMethod: ExtractionMethod;
  quality: 'full' | 'partial';
  warnings: string[];
}
export interface Attempt {
  strategy: string;
  url: string;
  status: 'success' | 'failed' | 'partial';
  httpStatus?: number;
  message: string;
  durationMs: number;
}
export interface CaptureResult {
  article: Article;
  attempts: Attempt[];
  rawHtml: string;
}
export interface Snapshot {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  siteName: string;
  byline: string | null;
  capturedAt: string;
  publishedAt: string | null;
  contentHash: string;
  wordCount: number;
  quality: 'full' | 'partial';
  extractionMethod: ExtractionMethod;
  objectKey: string;
}
export interface StoredCapture extends CaptureResult {
  snapshot: Snapshot;
}
