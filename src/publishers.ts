export interface Publisher {
  name: string;
  hosts: string[];
  selectors: string[];
  /** Publisher-owned public article representations, tried by the capture pipeline. */
  amp?: boolean;
}

export const PUBLISHERS: Publisher[] = [
  { name: 'The New York Times', hosts: ['nytimes.com'], selectors: ['section[name="articleBody"]', '[data-testid="article-body"]', '.StoryBodyCompanionColumn', '.articleBody'], amp: true },
  { name: 'The Washington Post', hosts: ['washingtonpost.com'], selectors: ['.article-body', '[data-qa="article-body"]', '.teaser-content', '.story-body'], amp: true },
  { name: 'The Wall Street Journal', hosts: ['wsj.com'], selectors: ['.article-content', '.wsj-snippet-body', '[data-testid="article-body"]', '.articleBody', 'article section'], amp: true },
  { name: 'Financial Times', hosts: ['ft.com'], selectors: ['.article__content-body', '.article-body', '#article-body'], amp: true },
  { name: 'Bloomberg', hosts: ['bloomberg.com'], selectors: ['.body-copy', '.body-content', '[data-component="body"]', '.story-body'] },
  { name: 'The Economist', hosts: ['economist.com'], selectors: ['.article__body', '[data-test-id="ArticleBody"]', '.article-body', '[class*="Article_body"]'] },
  { name: 'Reuters', hosts: ['reuters.com'], selectors: ['[data-testid="Body"]', '[data-testid="article-body"]', '.article-body', '.ArticleBody__content___2gQno'] },
  { name: 'Associated Press', hosts: ['apnews.com'], selectors: ['.RichTextStoryBody', '.Article', '.article-body'] },
  { name: 'BBC', hosts: ['bbc.com', 'bbc.co.uk'], selectors: ['[data-component="text-block"]', '.story-body__inner', '[data-testid="article-body"]', '[class*="ArticleWrapper"]'] },
  { name: 'CNN', hosts: ['cnn.com'], selectors: ['.article__content', '.article__body', '.zn-body__read-all', '.l-container', '[data-editable="content"]'] },
  { name: 'NPR', hosts: ['npr.org'], selectors: ['#storytext', '.storytext', '[data-testid="story-body"]'] },
  { name: 'The Guardian', hosts: ['theguardian.com'], selectors: ['#maincontent', '.article-body-commercial-selector', '.content__article-body', '[data-gu-name="body"]'] },
  { name: 'Al Jazeera', hosts: ['aljazeera.com'], selectors: ['.wysiwyg', '.article-p-wrapper', '.article-body'] },
  { name: 'Politico', hosts: ['politico.com', 'politico.eu'], selectors: ['.story-text', '.story-text__paragraph', '.article-content', '.article-body'] },
  { name: 'Axios', hosts: ['axios.com'], selectors: ['[data-testid="story-body"]', '.StoryBody', '.article-body', '[class*="StoryBody"]'] },
  { name: 'Ars Technica', hosts: ['arstechnica.com'], selectors: ['.article-content', '.post-content', '[itemprop="articleBody"]'] },
  { name: 'The Verge', hosts: ['theverge.com'], selectors: ['.duet--article--article-body-component', '.c-entry-content', '[data-testid="article-body"]', '.article-body'] },
  { name: 'WIRED', hosts: ['wired.com'], selectors: ['.body__inner-container', '.body__container', '.article__body', '[data-testid="BodyWrapper"]'] },
  { name: 'The Atlantic', hosts: ['theatlantic.com'], selectors: ['.article-body', '[class*="ArticleBody"]', '.c-article-body'] },
  { name: 'ProPublica', hosts: ['propublica.org'], selectors: ['.article-body', '.article-body__content', '.story-body'] },
  { name: 'OregonLive', hosts: ['oregonlive.com'], selectors: ['.article__story', '.entry-content', '[class*="ArticleBody"]', '.article-body'] },
  { name: 'Medium', hosts: ['medium.com'], selectors: ['article', '.section-content', '[data-testid="story-body"]'] },
  { name: 'Substack', hosts: ['substack.com'], selectors: ['.available-content', '.body.markup', '.post-content', '.body'] },
  { name: 'The New Yorker', hosts: ['newyorker.com'], selectors: ['.body__inner-container', '.body__container', '.article-body'] },
  { name: 'Los Angeles Times', hosts: ['latimes.com'], selectors: ['.RichTextArticleBody', '.story-body', '.article-body'] },
  { name: 'USA Today', hosts: ['usatoday.com'], selectors: ['.gnt_ar_b', '.article-body'] },
  { name: 'NBC News', hosts: ['nbcnews.com', 'msnbc.com', 'cnbc.com'], selectors: ['.article-body__content', '.ArticleBody-articleBody', '.article-body'] },
  { name: 'CBS News', hosts: ['cbsnews.com'], selectors: ['.content__body', '.article__body', '.article-body'] },
  { name: 'ABC News', hosts: ['abcnews.go.com'], selectors: ['.Article__Content', '.article-body', '[data-testid="article-body"]'] },
  { name: 'Fox News', hosts: ['foxnews.com', 'foxbusiness.com'], selectors: ['.article-body', '.article-content'] },
  { name: 'The Hill', hosts: ['thehill.com'], selectors: ['.article__text', '.entry-content', '.article-body'] },
  { name: 'The Intercept', hosts: ['theintercept.com'], selectors: ['.entry-content', '.post-content', '.article-body'] },
  { name: '404 Media', hosts: ['404media.co'], selectors: ['.gh-content', '.post-content', '.article-body'] },
  { name: 'The Conversation', hosts: ['theconversation.com'], selectors: ['.article-body', '[itemprop="articleBody"]'] },
  { name: 'TIME', hosts: ['time.com'], selectors: ['.article-body', '#article-body', '.content'] },
  { name: 'Newsweek', hosts: ['newsweek.com'], selectors: ['.article-body', '.article-content'] },
  { name: 'The Independent', hosts: ['independent.co.uk'], selectors: ['#main', '.article-body', '[class*="ArticleBody"]'] },
  { name: 'The Telegraph', hosts: ['telegraph.co.uk'], selectors: ['.article-body-text', '.article-body', '[itemprop="articleBody"]'] },
  { name: 'The Times', hosts: ['thetimes.com', 'thetimes.co.uk'], selectors: ['.article-body', '.article-body-content', '[data-testid="article-body"]'] },
  { name: 'Scientific American', hosts: ['scientificamerican.com'], selectors: ['.article-body', '[class*="ArticleBody"]'] },
  { name: 'Nature', hosts: ['nature.com'], selectors: ['.c-article-body', '#body', '.article-body'] },
  { name: 'TechCrunch', hosts: ['techcrunch.com'], selectors: ['.entry-content', '.wp-block-post-content', '.article-body'] },
  { name: 'Engadget', hosts: ['engadget.com'], selectors: ['.caas-body', '.article-body'] },
  { name: 'Yahoo News', hosts: ['news.yahoo.com', 'yahoo.com'], selectors: ['.caas-body', '.article-body'] },
  { name: 'Business Insider', hosts: ['businessinsider.com', 'insider.com'], selectors: ['.content-lock-content', '.content-lock-content-wrapper', '.article-body'] },
  { name: 'Fortune', hosts: ['fortune.com'], selectors: ['.article-body', '[class*="articleBody"]'] },
  { name: 'Forbes', hosts: ['forbes.com'], selectors: ['.article-body', '.body-container', '[class*="ArticleBody"]'] },
];

export function publisherForUrl(url: string): Publisher | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PUBLISHERS.find(publisher => publisher.hosts.some(domain => host === domain || host.endsWith(`.${domain}`))) || null;
  } catch { return null; }
}

/** Every selector is additive: some publishers split their story into many text blocks. */
export function publisherSelectors(url: string): string[] {
  return publisherForUrl(url)?.selectors || [];
}
