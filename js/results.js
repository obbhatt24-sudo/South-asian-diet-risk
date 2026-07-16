// results.js — renders score cards into the results view.

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

function buildBreakdownNote(text) {
  const note = document.createElement('p');
  note.className = 'breakdown-note';
  note.textContent = text;
  return note;
}

// Each row is { label, pts } for a scored sub-factor, or { label, na: true }
// for an unavailable one (shown muted, 0 pts, no bold). An optional `note`
// renders directly below its row.
function buildScoreCard(title, scoreObj, description, rows, notes) {
  const bandClass = scoreObj.band.toLowerCase();

  const card = document.createElement('div');
  card.className = 'score-card ' + bandClass;

  const heading = document.createElement('h3');
  heading.textContent = title;

  const number = document.createElement('div');
  number.className = 'score-number';
  number.textContent = String(scoreObj.score);

  const bandLabel = document.createElement('div');
  bandLabel.className = 'score-band ' + bandClass;
  bandLabel.textContent = scoreObj.band;

  const contextLabel = document.createElement('div');
  contextLabel.className = 'score-context';
  contextLabel.textContent = state.context === 'us'
    ? 'US South Asian context'
    : 'India context';

  const desc = document.createElement('p');
  desc.className = 'score-description';
  desc.textContent = description;

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Show breakdown';
  details.appendChild(summary);

  for (const rowSpec of rows) {
    const row = document.createElement('div');
    row.className = rowSpec.na ? 'breakdown-row na' : 'breakdown-row';

    const label = document.createElement('span');
    label.textContent = rowSpec.label;
    row.appendChild(label);

    const pts = document.createElement('span');
    if (rowSpec.na) {
      pts.textContent = '0 pts';
    } else {
      pts.className = 'pts';
      pts.textContent = rowSpec.pts + ' pts';
    }
    row.appendChild(pts);

    details.appendChild(row);
    if (rowSpec.note) {
      details.appendChild(buildBreakdownNote(rowSpec.note));
    }
  }
  for (const noteText of notes) {
    details.appendChild(buildBreakdownNote(noteText));
  }

  card.appendChild(heading);
  card.appendChild(number);
  if (scoreObj.score === 0) {
    const minimal = document.createElement('div');
    minimal.className = 'score-minimal';
    minimal.textContent = 'Minimal risk contribution';
    card.appendChild(minimal);
  }
  [bandLabel, contextLabel, desc, details].forEach(function(el) {
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
    { label: 'Glycemic Load: GL=' + d.gl.toFixed(1), pts: d.subScores.glycemic_load },
    { label: 'Refined Carbs: ' + Math.round(d.refShare * 100) + '% refined', pts: d.subScores.refined_carb },
    { label: 'Fiber: ' + nutrients.fiber_g.toFixed(1) + 'g', pts: d.subScores.fiber },
    { label: 'Protein Quality: ' + Math.round(d.protShare * 100) + '% quality protein', pts: d.subScores.protein_quality }
  ];
  const diabetesNotes = [];
  if (mealUsedGiDefaults(state.mealItems)) {
    diabetesNotes.push('* GL estimated from food-group defaults for some ingredients.');
  }
  container.appendChild(buildScoreCard(
    'Diabetes Risk Score', d, DIABETES_BAND_TEXT[d.band], diabetesRows, diabetesNotes
  ));

  const diabetesRiskNote = document.createElement('p');
  diabetesRiskNote.className = 'risk-note';
  diabetesRiskNote.textContent = 'Note: South Asians are predisposed to greater ' +
    'visceral fat accumulation per unit of body weight — a risk factor not ' +
    'fully captured by meal-level scoring (ICMR-INDIAB, 2023).';
  container.appendChild(diabetesRiskNote);

  const fatQualityRow = c.ratio === null
    ? { label: 'Fat quality: N/A — fat type data unavailable', na: true }
    : { label: 'Fat Quality: ratio=' + c.ratio.toFixed(2), pts: c.subScores.fat_quality };
  if (c.usedFallback) {
    fatQualityRow.note = '* Fat quality estimated from food-group data.';
  }
  const cvdRows = [
    { label: 'Saturated Fat: ' + nutrients.saturated_fat_g.toFixed(1) + 'g', pts: c.subScores.saturated_fat },
    fatQualityRow,
    { label: 'Fiber: ' + nutrients.fiber_g.toFixed(1) + 'g', pts: c.subScores.fiber },
    c.totalSodium === null
      ? { label: 'Sodium: N/A — salt input not provided', na: true }
      : { label: 'Sodium: ' + Math.round(c.totalSodium) + 'mg', pts: c.subScores.sodium }
  ];
  container.appendChild(buildScoreCard(
    'CVD Risk Score', c, CVD_BAND_TEXT[c.band], cvdRows, []
  ));

  const cvdRiskNote = document.createElement('p');
  cvdRiskNote.className = 'risk-note';
  cvdRiskNote.textContent = 'Note: approximately 25% of South Asians carry ' +
    'elevated Lp(a) lipoprotein — a genetic cardiovascular risk factor not ' +
    'modifiable by diet and not captured by this score. A low CVD score ' +
    'does not eliminate this baseline risk (MASALA Study; Tsimikas et al.).';
  container.appendChild(cvdRiskNote);

  renderRecommendations(recs, result);
}

function renderRecommendations(recs, currentScores) {
  const container = document.getElementById('recommendations-container');
  container.innerHTML = '';

  if (recs.length === 0) {
    const none = document.createElement('div');
    none.className = 'no-recs';
    none.textContent = 'No high-impact swaps found — this meal scores well on risk factors.';
    container.appendChild(none);
    return;
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Suggested improvements';
  container.appendChild(heading);

  recs.forEach(function(rec, index) {
    const card = document.createElement('div');
    const isReduce = rec.intervention === 'reduce';
    card.className = isReduce ? 'rec-card rec-tip' : 'rec-card rec-swap';

    const badge = document.createElement('span');
    badge.className = 'rec-badge';
    badge.textContent = isReduce ? 'Tip' : rec.intervention === 'replace' ? 'Swap' : 'Add';
    card.appendChild(badge);

    const instruction = document.createElement('p');
    instruction.className = 'rec-instruction';
    instruction.textContent = rec.instructionText;
    card.appendChild(instruction);

    const impact = document.createElement('div');
    impact.className = 'rec-impact';
    if (isReduce) {
      impact.textContent = 'Estimated to reduce your ' + rec.scoreName + ' score by ~' +
        rec.delta + ' points if quantity is halved.';
      card.appendChild(impact);
    } else {
      impact.textContent = 'Your ' + rec.scoreName + ' score would drop from ' +
        currentScores[rec.scoreName].score + ' → ' + rec.previewScore;
      card.appendChild(impact);

      const applyBtn = document.createElement('button');
      applyBtn.className = 'apply-btn';
      applyBtn.id = 'apply-' + index;
      applyBtn.textContent = 'Apply this swap';
      applyBtn.addEventListener('click', function() {
        applyRecommendation(rec, index);
      });
      card.appendChild(applyBtn);
    }

    container.appendChild(card);
  });
}

function applyRecommendation(rec, index) {
  if (rec.intervention === 'replace') {
    if (rec.fromDishId) {
      const dishIndex = state.mealItems.findIndex(function(item) {
        return item.type === 'dish' && item.id === rec.fromDishId;
      });
      if (dishIndex !== -1) {
        const exploded = explodeDish(state.mealItems[dishIndex]).map(function(ing) {
          return ing.id === rec.sourceId ? { ...ing, id: rec.targetId } : ing;
        });
        state.mealItems.splice(dishIndex, 1, ...exploded);
        alert('Dish expanded into ingredients to apply swap.');
      }
    } else {
      const item = state.mealItems.find(function(it) {
        return it.type === 'ingredient' && it.id === rec.sourceId;
      });
      if (item) item.id = rec.targetId;
    }
  } else if (rec.intervention === 'add') {
    state.mealItems.push({
      type: 'ingredient',
      id: rec.targetId,
      gramAmount: rec.standardPortion
    });
  }

  renderMealItems();
  updateNutrientTotals();

  const result = score(
    state.mealItems,
    state.addedSodiumMg,
    state.context,
    state.personalContext
  );
  const recs = recommend(
    result.diabetes,
    result.cvd,
    state.mealItems,
    state.addedSodiumMg,
    state.context,
    state.personalContext
  );
  renderResults(result, recs);
}
