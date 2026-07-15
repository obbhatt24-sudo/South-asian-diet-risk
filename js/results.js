// results.js — renders score cards into the results view.

const BAND_COLOURS = {
  Low: '#2E7D32',
  Moderate: '#E65100',
  High: '#B71C1C'
};

const DIABETES_BAND_TEXT = {
  Low: 'This meal contributes minimally to diabetes risk factors.',
  Moderate: 'This meal has notable diabetes risk-relevant features.',
  High: 'This meal meaningfully elevates diabetes risk factors.'
};

const CVD_BAND_TEXT = {
  Low: 'This meal contributes minimally to cardiovascular risk factors.',
  Moderate: 'This meal has notable cardiovascular risk-relevant features.',
  High: 'This meal meaningfully elevates cardiovascular risk factors.'
};

// Mirrors getGI()'s fallback chain to detect when a food-group default GI
// was used (no per-ingredient GI and no curated override).
function mealUsedGiDefaults(mealItems) {
  const usedDefault = function(ingredientId) {
    if (_giOverrides[ingredientId] !== undefined) return false;
    const ing = getIngredientById(ingredientId);
    if (!ing) return false;
    if (ing.glycemic_index !== null && ing.glycemic_index !== undefined) return false;
    return FOOD_GROUP_GI[ing.food_group] !== undefined;
  };

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      if (usedDefault(item.id)) return true;
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      for (const di of dish.ingredients) {
        if (usedDefault(di.ingredient_id)) return true;
      }
    }
  }
  return false;
}

function buildScoreCard(title, scoreObj, description, rows, notes) {
  const card = document.createElement('div');
  card.className = 'score-card';
  card.style.borderLeft = '4px solid ' + BAND_COLOURS[scoreObj.band];

  const heading = document.createElement('h3');
  heading.textContent = title;

  const number = document.createElement('div');
  number.className = 'score-number';
  number.textContent = scoreObj.score;

  const bandLabel = document.createElement('div');
  bandLabel.className = 'score-band';
  bandLabel.textContent = scoreObj.band;

  const desc = document.createElement('p');
  desc.className = 'score-description';
  desc.textContent = description;

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Show breakdown';
  details.appendChild(summary);

  for (const rowText of rows) {
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.textContent = rowText;
    details.appendChild(row);
  }
  for (const noteText of notes) {
    const note = document.createElement('p');
    note.className = 'breakdown-note';
    note.textContent = noteText;
    details.appendChild(note);
  }

  [heading, number, bandLabel, desc, details].forEach(function(el) {
    card.appendChild(el);
  });
  return card;
}

function renderResults(result, recs) {
  const container = document.getElementById('scores-container');
  container.innerHTML = '';

  const nutrients = computeMealNutrients(state.mealItems);
  const d = result.diabetes;
  const c = result.cvd;

  const diabetesRows = [
    'Glycemic Load: GL=' + d.gl.toFixed(1) + ' → ' + d.subScores.glycemic_load + ' pts',
    'Refined Carbs: ' + Math.round(d.refShare * 100) + '% refined → ' + d.subScores.refined_carb + ' pts',
    'Fiber: ' + nutrients.fiber_g.toFixed(1) + 'g → ' + d.subScores.fiber + ' pts',
    'Protein Quality: ' + Math.round(d.protShare * 100) + '% quality protein → ' + d.subScores.protein_quality + ' pts'
  ];
  const diabetesNotes = [];
  if (mealUsedGiDefaults(state.mealItems)) {
    diabetesNotes.push('* GL estimated from food-group defaults for some ingredients.');
  }
  container.appendChild(buildScoreCard(
    'Diabetes Risk Score', d, DIABETES_BAND_TEXT[d.band], diabetesRows, diabetesNotes
  ));

  const cvdRows = [
    'Saturated Fat: ' + nutrients.saturated_fat_g.toFixed(1) + 'g → ' + c.subScores.saturated_fat + ' pts',
    c.ratio === null
      ? 'Fat Quality: N/A'
      : 'Fat Quality: ratio=' + c.ratio.toFixed(2) + ' → ' + c.subScores.fat_quality + ' pts',
    'Fiber: ' + nutrients.fiber_g.toFixed(1) + 'g → ' + c.subScores.fiber + ' pts',
    c.totalSodium === null
      ? 'Sodium: N/A — salt input not provided'
      : 'Sodium: ' + Math.round(c.totalSodium) + 'mg → ' + c.subScores.sodium + ' pts'
  ];
  const cvdNotes = [];
  if (c.usedFallback) {
    cvdNotes.push('* Fat quality estimated from food-group data.');
  }
  container.appendChild(buildScoreCard(
    'CVD Risk Score', c, CVD_BAND_TEXT[c.band], cvdRows, cvdNotes
  ));

  document.getElementById('recommendations-container').textContent =
    'Recommendations loading...';
}
