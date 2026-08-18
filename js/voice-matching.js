let _synonyms = null;

async function loadSynonyms() {
  if (_synonyms) return _synonyms;
  // Prefer the copy loadData() already fetched in data.js; fall back to a
  // direct fetch so this file keeps working if that wiring changes.
  if (typeof _voiceSynonyms !== 'undefined' && _voiceSynonyms && _voiceSynonyms.length) {
    _synonyms = _voiceSynonyms;
    return _synonyms;
  }
  const res = await fetch('data/voice-synonyms.json');
  _synonyms = await res.json();
  return _synonyms;
}

// Layer 1: Exact match on ingredient name or alias
function exactMatch(term, ingredients) {
  const t = term.toLowerCase().trim();
  return ingredients.find(ing =>
    ing.name.toLowerCase() === t ||
    (ing.aliases || []).some(a => a.toLowerCase() === t)
  ) || null;
}

// Layer 2: Synonym lookup
function synonymMatch(term, synonyms) {
  const t = term.toLowerCase().trim();
  return synonyms.find(s =>
    s.spoken === t ||
    (s.spoken_variants || []).some(v => v.toLowerCase() === t)
  ) || null;
}

// Layer 3: Edit distance (Levenshtein)
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) =>
    Array.from({length: n+1}, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Ingredient names in this DB carry descriptor suffixes ("Basmati rice, raw",
// "Chickpeas (kabuli chana), raw") that inflate edit distance against a bare
// spoken term ("basmati riss"); strip them before comparing.
function normalizeIngredientName(name) {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/,\s*(raw|cooked|milled|whole)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function editDistanceMatch(term, ingredients) {
  const t = term.toLowerCase().trim();
  if (t.length < 4) return null;  // too short to match reliably
  let best = null, bestDist = 3;  // max distance of 2
  for (const ing of ingredients) {
    const d = levenshtein(t, normalizeIngredientName(ing.name));
    if (d < bestDist) { best = ing; bestDist = d; }
  }
  return best;
}

// Layer 4: Claude disambiguation for unmatched terms.
// Runs server-side (RAG_SERVER_URL, defined in explainer.js) so the
// Anthropic API key stays secret — the browser cannot call
// api.anthropic.com directly (same constraint as /parse-meal).
async function claudeDisambiguate(unmatched, ingredients) {
  if (!unmatched.length) return [];
  const topNames = ingredients.slice(0, 80).map(i => i.name);

  try {
    const res = await fetch(RAG_SERVER_URL + '/disambiguate-ingredients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terms: unmatched, ingredient_names: topNames }),
      signal: AbortSignal.timeout(60000)  // cover Render free-tier cold starts
    });
    if (!res.ok) throw new Error('Server error: ' + res.status);
    const data = await res.json();
    return data.matches || [];
  } catch(e) {
    console.warn('Ingredient disambiguation failed:', e);
    return unmatched.map(s => ({ spoken: s, matched_name: null, confidence: 'low' }));
  }
}

// Main matching function — returns structured result for confirmation step
async function matchVoiceItems(parsedItems) {
  const synonyms = await loadSynonyms();
  const results = [];
  const needsClaude = [];

  for (const item of parsedItems) {
    const term = item.name;
    let result = {
      spoken: term,
      grams: item.grams || 100,
      cooking_method: item.cooking_method || null,
      match_type: null,
      ingredient: null,
      options: [],
      needs_disambiguation: false,
      ask_user: false,
    };

    // Layer 1: exact
    const exact = exactMatch(term, _ingredients);
    if (exact) {
      result.match_type = 'exact';
      result.ingredient = exact;
      results.push(result);
      continue;
    }

    // Layer 2: synonym
    const syn = synonymMatch(term, synonyms);
    if (syn) {
      if (syn.match_type === 'direct') {
        result.match_type = 'synonym';
        result.ingredient = getIngredientById(syn.default_id);
        results.push(result);
        continue;
      }
      if (syn.match_type === 'disambiguate') {
        result.match_type = 'disambiguate';
        result.options = syn.ingredient_ids
          .map(id => getIngredientById(id)).filter(Boolean);
        result.ingredient = getIngredientById(syn.default_id);
        result.needs_disambiguation = true;
        results.push(result);
        continue;
      }
      if (syn.match_type === 'ask') {
        result.match_type = 'ask';
        result.ask_user = true;
        results.push(result);
        continue;
      }
    }

    // Layer 3: edit distance
    const fuzzy = editDistanceMatch(term, _ingredients);
    if (fuzzy) {
      result.match_type = 'fuzzy';
      result.ingredient = fuzzy;
      results.push(result);
      continue;
    }

    // Layer 4: queue for Claude
    needsClaude.push(term);
    result.match_type = 'pending_claude';
    results.push(result);
  }

  // Batch Claude disambiguation for all unmatched
  if (needsClaude.length) {
    const claudeMatches = await claudeDisambiguate(needsClaude, _ingredients);
    for (const cm of claudeMatches) {
      const r = results.find(r => r.spoken === cm.spoken);
      if (!r) continue;
      if (cm.matched_name && cm.confidence !== 'low') {
        r.ingredient = _ingredients.find(i =>
          i.name.toLowerCase() === cm.matched_name.toLowerCase());
        r.match_type = 'claude';
      } else {
        r.match_type = 'unmatched';
      }
    }
  }

  return results;
}
