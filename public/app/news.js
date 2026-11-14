// News page: the IntelMap news feed.
// Moved unchanged from app.js; see app.js for the startup and button wiring.
import { newsCard, newsMetrics, relativeTime } from '../news-view.js?v=2';
import { emptyState, escapeHtml, safeHttpUrl } from '../ui.js?v=6';
import { $, api } from './core.js';
import { humanize } from './results.js';

const intelNews = {
  events: [],
  metrics: null,
  categories: [],
  generatedAt: '',
  loaded: false,
  loading: false,
  error: '',
  visibleLimit: 30
};

const safeExternalUrl = value => safeHttpUrl(value) || '#';
// News: cards and metrics come from news-view.js; the status line (a live region) says what is happening in words.
function renderIntelNews() {
  const list = $('#intelNewsList');
  if (!list) return;
  const status = $('#intelNewsStatus');
  if (intelNews.loading) {
    status.textContent = 'Loading news…';
    list.innerHTML = '';
    return;
  }
  if (intelNews.error) {
    status.textContent = "Couldn't reach IntelMap. Check your internet connection and try again.";
    list.innerHTML = '<button class="ghost" id="retryIntelNews">Try again</button>';
    $('#retryIntelNews').addEventListener('click', () => {
      $('#refreshIntelNews').focus();
      loadIntelNews(true);
    });
    return;
  }
  const filter = $('#intelNewsFilter').value.trim().toLowerCase();
  const category = $('#intelNewsCategory').value;
  const matching = intelNews.events.filter(
    event =>
      (!category || event.category === category) &&
      (!filter ||
        [event.title, event.description, event.source, event.country, event.region, event.category].some(value =>
          String(value || '')
            .toLowerCase()
            .includes(filter)
        ))
  );
  const events = matching.slice(0, intelNews.visibleLimit);
  $('#intelNewsMetrics').innerHTML = newsMetrics(intelNews.metrics, intelNews.events.length, { escapeHtml });
  $('#intelNewsFreshness').textContent =
    `${intelNews.generatedAt ? `Updated ${relativeTime(intelNews.generatedAt)} · ` : ''}Showing ${events.length} of ${matching.length}`;
  // A live region: rewrite it only when its words change, so filtering does not re-announce it on every keystroke.
  const loadedText = intelNews.loaded
    ? `${intelNews.events.length} news event${intelNews.events.length === 1 ? '' : 's'} loaded`
    : '';
  if (status.textContent !== loadedText) status.textContent = loadedText;
  list.innerHTML = events.length
    ? events.map(event => newsCard(event, { escapeHtml, safeExternalUrl })).join('') +
      (matching.length > events.length
        ? '<button class="ghost news-load-more" data-load-more-news>Load more news</button>'
        : '')
    : emptyState({ title: 'No news matches these filters.', text: 'Try a different word or category.' });
}
async function loadIntelNews(force = false) {
  if (intelNews.loading || (!force && intelNews.loaded)) return;
  intelNews.loading = true;
  intelNews.error = '';
  intelNews.visibleLimit = 30;
  renderIntelNews();
  try {
    const response = await fetch('https://intelmap.watch/api/feed/', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`IntelMap returned ${response.status}`);
    const data = await response.json();
    intelNews.events = Array.isArray(data.events) ? data.events : [];
    intelNews.metrics = data.metrics || null;
    intelNews.categories = Array.isArray(data.categories) ? data.categories : [];
    intelNews.generatedAt = data.generatedAt || data.cacheTimestamp || new Date().toISOString();
    intelNews.loaded = true;
    const select = $('#intelNewsCategory');
    const current = select.value;
    select.innerHTML =
      '<option value="">All categories</option>' +
      intelNews.categories
        .map(
          item =>
            `<option value="${escapeHtml(item.name)}">${escapeHtml(humanize(item.name))} (${escapeHtml(item.count)})</option>`
        )
        .join('');
    select.value = current;
  } catch (error) {
    console.warn('IntelMap news failed to load:', error);
    intelNews.error = error.message || 'failed';
  } finally {
    intelNews.loading = false;
    renderIntelNews();
  }
}

export { intelNews, safeExternalUrl, renderIntelNews, loadIntelNews };
