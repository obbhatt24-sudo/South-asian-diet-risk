let _researchTopics = null;

async function loadResearchTopics() {
  if (_researchTopics) return _researchTopics;
  const res = await fetch('data/research-topics.json');
  _researchTopics = await res.json();
  return _researchTopics;
}

async function initLearnMore() {
  const topics = await loadResearchTopics();
  const container = document.getElementById('learn-more-topics');
  container.innerHTML = topics.map((t, i) => `
    <div class='topic-card card'>
      <h3 class='topic-title'>${t.title}</h3>
      <p class='topic-explanation'>${t.plain_explanation}</p>
      <p class='topic-why'><strong>Why it matters for South Asians:</strong>
        ${t.why_it_matters}</p>
      <div class='topic-papers'>
        <h4 class='topic-papers-heading'>Research papers</h4>
        ${t.papers.map(paper => `
          <div class='paper-item'>
            <a href='${paper.url}' target='_blank' rel='noopener'
               class='paper-link'>${paper.title}</a>
            <p class='paper-note'>${paper.note}</p>
          </div>
        `).join('')}
      </div>
      <div id='ai-overview-${i}' class='ai-overview-container'></div>
      <button class='btn-ai-overview'
              onclick='generateAIOverview(${i}, "${t.flag}")'
              id='ai-btn-${i}'>
        ✦ Generate AI research overview
      </button>
    </div>
  `).join('');
}

const OVERVIEW_CACHE_KEY = 'overview_cache_';

async function generateAIOverview(topicIndex, flag) {
  const btn       = document.getElementById(`ai-btn-${topicIndex}`);
  const container = document.getElementById(`ai-overview-${topicIndex}`);

  // Check sessionStorage cache first
  const cacheKey = OVERVIEW_CACHE_KEY + flag + '_' + state.context;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    renderAIOverview(container, JSON.parse(cached));
    btn.style.display = 'none';
    return;
  }

  btn.disabled = true;
  btn.textContent = '✦ Generating overview...';
  container.innerHTML = `
    <div class='ai-overview-loading'>
      <div class='explanation-spinner'></div>
      <span>Retrieving research context and generating overview...</span>
    </div>`;

  try {
    const response = await fetch(RAG_SERVER_URL + '/topic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flag, context: state.context }),
      signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) throw new Error('Server error: ' + response.status);
    const data = await response.json();

    // Cache in sessionStorage
    sessionStorage.setItem(cacheKey, JSON.stringify(data));

    renderAIOverview(container, data);
    btn.style.display = 'none';
  } catch(err) {
    container.innerHTML = `
      <p class='ai-overview-error'>
        Could not generate overview (${err.name === 'TimeoutError'
          ? 'server warming up — try again in 30 seconds'
          : err.message}).
      </p>`;
    btn.disabled = false;
    btn.textContent = '✦ Try again';
  }
}

function renderAIOverview(container, data) {
  const citations = (data.chunks_used || []).map(c =>
    `<li><em>${c.source}</em>: ${c.citation}</li>`
  ).join('');

  container.innerHTML = `
    <div class='ai-overview'>
      <div class='ai-overview-header'>
        <span class='ai-overview-label'>✦ AI research overview</span>
        <span class='ai-overview-note'>
          Generated from your research corpus using Claude claude-sonnet-4-6.
          Educational only — not medical advice.
        </span>
      </div>
      <div class='ai-overview-text'>${data.overview}</div>
      <details class='ai-overview-sources'>
        <summary>Research sources retrieved</summary>
        <ul>${citations}</ul>
      </details>
    </div>`;
}
