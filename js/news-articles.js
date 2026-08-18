/* Shared news article rendering for index.html and news.html.
   Content lives in site_content (content_key='news_articles'), scoped per
   org. A brand-new org has no news yet — there is no fake seed content
   here; the grid/lists just render empty until an admin publishes articles
   via the News Manager panel. */
const NEWS_ARTICLES_CONTENT_KEY = 'news_articles';

function newsEsc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeNewsArticle(article) {
  if (!article || typeof article !== 'object') return null;
  const placement = article.placement === 'sidebar' ? 'sidebar' : 'main';
  return {
    title: String(article.title || '').trim(),
    tag: String(article.tag || '').trim(),
    date: String(article.date || '').trim(),
    image: String(article.image || '').trim(),
    excerpt: String(article.excerpt || '').trim(),
    body: String(article.body || '').trim(),
    placement: placement,
    featured: !!article.featured,
    published: article.published !== false
  };
}

function normalizeNewsArticles(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw.map(normalizeNewsArticle).filter(Boolean);
}

async function fetchNewsArticles() {
  try {
    const rows = await sb.getAll('site_content', `${MF.scope(`content_key=eq.${encodeURIComponent(NEWS_ARTICLES_CONTENT_KEY)}&select=content_json&limit=1`)}`);
    const normalized = rows && rows.length ? normalizeNewsArticles(rows[0].content_json) : null;
    return normalized || [];
  } catch (err) {
    return [];
  }
}

function getPublishedNewsArticles(articles) {
  return (articles || []).filter(function(a) { return a && a.published !== false && a.title; });
}

// Parse a freeform date string like "June 2025", "December 2023", "2023" into a sortable value.
function newsDateSortKey(dateStr) {
  const MONTHS = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
  const s = String(dateStr || '').trim().toLowerCase();
  if (!s) return 0;
  const mY = s.match(/^([a-z]+)\s+(\d{4})$/);
  if (mY && MONTHS[mY[1]] !== undefined) return parseInt(mY[2], 10) * 100 + MONTHS[mY[1]];
  const yOnly = s.match(/^(\d{4})$/);
  if (yOnly) return parseInt(yOnly[1], 10) * 100;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return parseInt(mdy[3], 10) * 100 + parseInt(mdy[1], 10) - 1;
  return 0;
}

function sortNewsNewestFirst(articles) {
  return articles.slice().sort(function(a, b) {
    return newsDateSortKey(b.date) - newsDateSortKey(a.date);
  });
}

function renderNewsBodyParagraphs(body, extraStyle) {
  const text = String(body || '').trim();
  if (!text) return '';
  const style = extraStyle ? ' style="' + extraStyle + '"' : '';
  return text.split(/\n\n+/).map(function(paragraph) {
    return '<p' + style + '>' + newsEsc(paragraph).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function newsLogoFallbackMarkup(height) {
  const logo = (window.MF && MF.org && MF.org.logo_url) || 'images/default-logo.svg';
  return '<div style="background:var(--ink);height:' + (height || 280) + 'px;display:flex;align-items:center;justify-content:center;">' +
    '<img src="' + newsEsc(logo) + '" alt="" style="height:44%;width:auto;object-fit:contain;opacity:0.7;" />' +
    '</div>';
}

function pickHomeNewsArticles(articles) {
  const published = getPublishedNewsArticles(articles);
  const featured = published.filter(function(a) { return a.featured; });
  const pool = featured.length
    ? featured.concat(published.filter(function(a) { return !a.featured; }))
    : published.slice();
  const picks = [];
  const seen = {};
  pool.forEach(function(article) {
    if (picks.length >= 3) return;
    const key = article.title || '';
    if (seen[key]) return;
    seen[key] = true;
    picks.push(article);
  });
  return picks;
}

function renderHomeNewsGrid(container, articles) {
  if (!container) return;
  const picks = pickHomeNewsArticles(sortNewsNewestFirst(articles));
  container.innerHTML = '';
  if (!picks.length) {
    container.innerHTML = '<p style="color:var(--gray-600);grid-column:1/-1;">No news yet — check back soon.</p>';
    return;
  }
  picks.forEach(function(article, idx) {
    const card = document.createElement('div');
    card.className = 'news-card fade-up' + (idx === 0 ? ' featured' : '');
    const imageBlock = article.image
      ? '<div class="news-card-img"><img src="' + newsEsc(article.image) + '" alt="' + newsEsc(article.title) + '" /></div>'
      : '<div class="news-card-img">' + newsLogoFallbackMarkup(220) + '</div>';
    card.innerHTML = imageBlock +
      '<div class="news-body">' +
        '<span class="news-tag">' + newsEsc(article.tag || 'News') + '</span>' +
        '<h3>' + newsEsc(article.title) + '</h3>' +
        '<p>' + newsEsc(article.excerpt || article.body) + '</p>' +
        (article.date ? '<span class="news-meta">' + newsEsc(article.date) + '</span>' : '') +
      '</div>';
    container.appendChild(card);
  });
  container.querySelectorAll('.fade-up').forEach(function(el) {
    el.classList.add('visible');
  });
}

function renderNewsPageLists(mainEl, sidebarEl, articles) {
  const published = sortNewsNewestFirst(getPublishedNewsArticles(articles));
  const mainArticles = published.filter(function(a) { return a.placement !== 'sidebar'; });
  const sidebarArticles = published.filter(function(a) { return a.placement === 'sidebar'; });

  if (mainEl) {
    mainEl.innerHTML = '';
    if (!mainArticles.length) {
      mainEl.innerHTML = '<p style="color:var(--gray-600);">No news yet — check back soon.</p>';
    }
    mainArticles.forEach(function(article) {
      const card = document.createElement('div');
      card.className = 'news-featured-card fade-up visible';
      const imageHtml = article.image
        ? '<img src="' + newsEsc(article.image) + '" alt="' + newsEsc(article.title) + '" />'
        : newsLogoFallbackMarkup(280);
      const bodyHtml = renderNewsBodyParagraphs(article.body || article.excerpt);
      card.innerHTML =
        imageHtml +
        '<div class="body">' +
          '<span class="news-tag">' + newsEsc(article.tag || 'News') + '</span>' +
          '<h2>' + newsEsc(article.title) + '</h2>' +
          bodyHtml +
          (article.date ? '<div style="margin-top:20px;font-size:0.82rem;color:var(--gray-400);">' + newsEsc(article.date) + '</div>' : '') +
        '</div>';
      mainEl.appendChild(card);
    });
  }

  if (sidebarEl) {
    sidebarEl.innerHTML = '';
    sidebarArticles.forEach(function(article) {
      const item = document.createElement('div');
      item.className = 'sidebar-item';
      const thumb = article.image
        ? '<img src="' + newsEsc(article.image) + '" alt="' + newsEsc(article.title) + '" />'
        : '<img src="' + newsEsc((window.MF && MF.org && MF.org.logo_url) || 'images/default-logo.svg') + '" alt="" style="object-fit:contain;padding:8px;background:var(--ink);" />';
      item.innerHTML = thumb +
        '<div class="info">' +
          '<div class="tag">' + newsEsc(article.tag || 'News') + '</div>' +
          '<h4>' + newsEsc(article.title) + '</h4>' +
        '</div>';
      sidebarEl.appendChild(item);
    });
  }
}
