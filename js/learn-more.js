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
