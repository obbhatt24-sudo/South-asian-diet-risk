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

function buildScoreCard(title, scoreObj, description, rows, notes) {
  const bandClass = scoreObj.band.toLowerCase();

  const card = document.createElement('div');
  card.className = 'score-card ' + bandClass;

  const heading = document.createElement('h3');
  heading.textContent = title;

  const number = document.createElement('div');
  number.className = 'score-number';
  number.textContent = scoreObj.score;

  const bandLabel = document.createElement('div');
  bandLabel.className = 'score-band ' + bandClass;
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

  const diabetesRiskNote = document.createElement('p');
  diabetesRiskNote.className = 'risk-note';
  diabetesRiskNote.textContent = 'Note: South Asians are predisposed to greater ' +
    'visceral fat accumulation per unit of body weight — a risk factor not ' +
    'fully captured by meal-level scoring (ICMR-INDIAB, 2023).';
  container.appendChild(diabetesRiskNote);

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
