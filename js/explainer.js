const RAG_SERVER_URL = 'https://south-asian-diet-risk.onrender.com';

async function fetchExplanation(scoreResult, mealItems) {
  // Build the request payload from the score result
  const d = scoreResult.diabetes;
  const c = scoreResult.cvd;

  // Get top ingredients by weight from mealItems
  const topIngredients = mealItems
    .slice(0, 3)
    .map(item => {
      if (item.type === 'ingredient') {
        return getIngredientById(item.id)?.name || 'unknown';
      } else {
        return getDishById(item.id)?.name || 'unknown';
      }
    });

  // Merge flags from both scores, deduplicate
  const allFlags = [...new Set([...d.flags, ...c.flags])];

  const payload = {
    diabetes_score: d.score,
    diabetes_band: d.band,
    cvd_score: c.score,
    cvd_band: c.band,
    flags: allFlags,
    context: state.context,
    gl: d.gl,
    ref_carb_share: d.refShare,
    fiber_g: computeMealNutrients(mealItems).fiber_g,
    sfa_g: computeMealNutrients(mealItems).saturated_fat_g,
    mufa_sfa_ratio: c.ratio ?? null,
    top_ingredients: topIngredients,
    top_recommendation: null  // filled in below if recs available
  };

  return payload;
}

async function loadExplanation(scoreResult, recs, mealItems) {
  const panel = document.getElementById('explanation-panel');
  panel.innerHTML = '<p class="explanation-loading">Loading research explanation...</p>';

  try {
    const payload = await fetchExplanation(scoreResult, mealItems);
    if (recs.length > 0) {
      payload.top_recommendation = recs[0].instructionText;
    }

    const response = await fetch(RAG_SERVER_URL + '/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)  // 30s timeout for cold starts
    });

    if (!response.ok) throw new Error('Server error: ' + response.status);
    const data = await response.json();

    renderExplanation(data.explanation, data.chunks_used);
  } catch (err) {
    if (err.name === 'TimeoutError') {
      panel.innerHTML = `
        <p class='explanation-unavailable'>
          Research explanation timed out (server may be warming up).
          <button onclick='retryExplanation()'>Retry</button>
        </p>`;
    } else {
      panel.innerHTML = `
        <p class='explanation-unavailable'>
          Research explanation unavailable. See score breakdown above
          for the detailed sub-score analysis.
        </p>`;
    }
    console.warn('RAG explanation failed:', err.message);
  }
}

function renderExplanation(text, chunksUsed) {
  const panel = document.getElementById('explanation-panel');
  const citations = chunksUsed
    .map(c => `<li><em>${c.source}</em>: ${c.citation}</li>`)
    .join('');

  panel.innerHTML = `
    <div class='explanation-text'>${text}</div>
    <details class='explanation-sources'>
      <summary>Research sources used</summary>
      <ul>${citations}</ul>
    </details>
  `;
}

let _lastScoreResult = null;
let _lastRecs = null;
let _lastMealItems = null;

function retryExplanation() {
  if (_lastScoreResult) {
    loadExplanation(_lastScoreResult, _lastRecs, _lastMealItems);
  }
}
