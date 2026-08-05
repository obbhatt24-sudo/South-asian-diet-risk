// results.js — renders score cards into the results view.

// Band cutoffs: Low < 35, Moderate 35–64, High ≥ 65 (recalibrated in Step 34).
// Band descriptions are now sourced from the i18n files
// (scores.band_desc_low / _moderate / _high) via t().

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

// Reference meals used to give the user a sense of scale for their own score.
const REFERENCE_MEALS = [
  { name: 'Dal + roti + sabzi',       diabetes: 22, cvd: 18, quality: 'good' },
  { name: 'Rajma chawal',             diabetes: 38, cvd: 25, quality: 'moderate' },
  { name: 'White rice + dal makhani', diabetes: 52, cvd: 42, quality: 'moderate' },
  { name: 'Chole bhature',            diabetes: 65, cvd: 35, quality: 'high' }
];

function bandBarClass(score) {
  return score < 35 ? 'bar-low' : score < 65 ? 'bar-moderate' : 'bar-high';
}

// Renders an array of breakdown rows to HTML. Each row is either
// { na: true, label, sublabel, detail } (data unavailable) or
// { label, sublabel, value, max, detail, tip?, inverted? }.
function renderBreakdownRows(rows) {
  return rows.map(function(row) {
    if (row.na) {
      return `
        <div class='breakdown-row na'>
          <div class='breakdown-labels'>
            <span class='breakdown-label'>${row.label}</span>
            <span class='breakdown-sublabel'>${row.sublabel}</span>
          </div>
          <div class='breakdown-detail'>
            <span class='breakdown-pts'>N/A</span>
            <span class='breakdown-fact'>${row.detail}</span>
          </div>
        </div>
      `;
    }
    const frac = row.value / row.max;
    const bandCls = frac > 0.66 ? 'bar-high' : frac > 0.33 ? 'bar-moderate' : 'bar-low';
    return `
      <div class='breakdown-row'>
        <div class='breakdown-labels'>
          <span class='breakdown-label'>${row.label}</span>
          <span class='breakdown-sublabel'>${row.sublabel}</span>
        </div>
        <div class='breakdown-bar-wrap'>
          <div class='breakdown-bar ${row.inverted ? 'bar-inverted ' : ''}${bandCls}'
            style='width: ${Math.round(frac * 100)}%'>
          </div>
        </div>
        <div class='breakdown-detail'>
          <span class='breakdown-pts'>${row.value}/${row.max} pts</span>
          <span class='breakdown-fact'>${row.detail}</span>
        </div>
        ${row.tip ? `<p class='breakdown-tip'>💡 ${row.tip}</p>` : ''}
      </div>
    `;
  }).join('');
}

// d = result.diabetes from score(); d.fiberG is bridged in from meal nutrients.
function renderDiabetesBreakdown(d) {
  const rows = [
    {
      label: t('sub_scores.glycemic_load_label'),
      sublabel: t('sub_scores.glycemic_load_sub'),
      value: d.subScores.glycemic_load,
      max: 40,
      detail: `Glycemic load: ${d.gl.toFixed(1)}`,
      tip: d.subScores.glycemic_load > 20
        ? 'Try swapping white rice for basmati or adding a dal side.'
        : null
    },
    {
      label: t('sub_scores.refined_carb_label'),
      sublabel: t('sub_scores.refined_carb_sub'),
      value: d.subScores.refined_carb,
      max: 25,
      detail: `${Math.round(d.refShare * 100)}% refined carbs`,
      tip: d.subScores.refined_carb > 10
        ? 'Whole grains like atta, jowar, or brown rice reduce this.'
        : null
    },
    {
      label: t('sub_scores.fiber_label'),
      sublabel: t('sub_scores.fiber_sub'),
      value: d.subScores.fiber,
      max: 20,
      detail: `${d.fiberG != null ? d.fiberG.toFixed(1) : '?'}g fibre in this meal`,
      tip: d.subScores.fiber > 10
        ? 'Add vegetables, dal, or whole grains to increase fibre.'
        : null,
      inverted: true  // higher score = worse (less fibre)
    },
    {
      label: t('sub_scores.protein_label'),
      sublabel: t('sub_scores.protein_sub'),
      value: d.subScores.protein_quality,
      max: 15,
      detail: `${Math.round(d.protShare * 100)}% from legumes/dairy/fish`,
      tip: d.subScores.protein_quality > 8
        ? 'Adding dal, curd, or paneer improves protein quality.'
        : null,
      inverted: true
    }
  ];
  return renderBreakdownRows(rows);
}

// Same visual pattern as the diabetes breakdown. c.satFatG / c.fiberG are
// bridged in from meal nutrients; fat_quality and sodium may be null.
function renderCvdBreakdown(c) {
  const rows = [
    {
      label: t('sub_scores.sat_fat_label'),
      sublabel: t('sub_scores.sat_fat_sub'),
      value: c.subScores.saturated_fat,
      max: 40,
      detail: `${c.satFatG != null ? c.satFatG.toFixed(1) : '?'}g saturated fat`,
      tip: c.subScores.saturated_fat > 20
        ? 'Cook with less ghee, cream, or coconut oil to reduce this.'
        : null
    },
    c.subScores.fat_quality === null
      ? {
          label: t('sub_scores.fat_quality_label'),
          sublabel: t('sub_scores.fat_quality_sub'),
          na: true,
          detail: 'Fat type data unavailable'
        }
      : {
          label: t('sub_scores.fat_quality_label'),
          sublabel: t('sub_scores.fat_quality_sub'),
          value: c.subScores.fat_quality,
          max: 30,
          detail: `MUFA:SFA ratio ${c.ratio.toFixed(2)}`,
          tip: c.subScores.fat_quality > 15
            ? 'Replacing ghee or coconut oil with mustard oil would improve this.'
            : null,
          inverted: true
        },
    {
      label: t('sub_scores.fiber_label'),
      sublabel: t('sub_scores.fiber_sub'),
      value: c.subScores.fiber,
      max: 20,
      detail: `${c.fiberG != null ? c.fiberG.toFixed(1) : '?'}g fibre in this meal`,
      tip: c.subScores.fiber > 10
        ? 'Add vegetables, dal, or whole grains to increase fibre.'
        : null,
      inverted: true
    },
    c.subScores.sodium === null
      ? {
          label: t('sub_scores.sodium_label'),
          sublabel: t('sub_scores.sodium_sub'),
          na: true,
          detail: 'Salt input not provided'
        }
      : {
          label: t('sub_scores.sodium_label'),
          sublabel: t('sub_scores.sodium_sub'),
          value: c.subScores.sodium,
          max: 10,
          detail: `${Math.round(c.totalSodium)}mg sodium`,
          tip: c.subScores.sodium > 5
            ? 'Use less added salt and fewer pickles or papad.'
            : null
        }
  ];
  return renderBreakdownRows(rows);
}

// Plain-English summary of what is driving a score, from its flags.
// Explanation text lives in the i18n files under why_text.* so it can be
// localised; see generateWhyText() below.
function generateWhyText(scoreResult, scoreType) {
  const flags = scoreResult.flags;
  if (flags.length === 0) {
    return scoreType === 'diabetes'
      ? t('why_text.none_diabetes')
      : t('why_text.none_cvd');
  }

  // Take the top 2 flags by sub-score severity
  const topFlags = flags.slice(0, 2);
  return topFlags
    .map(function(f) { return t('why_text.' + f); })
    .filter(Boolean)
    .join(' ');
}

// scoreObj = result.diabetes|cvd; breakdownHtml/whyText are pre-rendered HTML/
// text; notes is an array of caveat strings shown below the breakdown.
function buildScoreCard(title, scoreObj, description, breakdownHtml, whyText, notes) {
  const bandClass = scoreObj.band.toLowerCase();
  const contextText = state.context === 'us'
    ? t('scores.context_us')
    : t('scores.context_india');
  const notesHtml = notes
    .map(function(n) { return `<p class='breakdown-note'>${n}</p>`; })
    .join('');

  const card = document.createElement('div');
  card.className = 'score-card ' + bandClass;
  card.innerHTML = `
    <h3>${title}</h3>
    <div class='score-header'>
      <div class='score-number'>${scoreObj.score}</div>
      <div class='score-meta'>
        <span class='score-band-label ${bandClass}'>${t('scores.band_' + bandClass)} ${t('scores.risk_contribution')}</span>
        <span class='score-out-of'>${t('scores.out_of')}</span>
        <span class='score-context-label'>${contextText}</span>
      </div>
    </div>
    <div class='score-bar-full'>
      <div class='score-bar-fill' style='width: ${scoreObj.score}%'></div>
    </div>
    ${scoreObj.score === 0 ? `<div class='score-minimal'>${t('scores.minimal')}</div>` : ''}
    <p class='score-description'>${description}</p>
    <details>
      <summary>${t('scores.show_breakdown')}</summary>
      ${breakdownHtml}
      ${notesHtml}
    </details>
    <details class='why-details'>
      <summary>${t('scores.what_driving')}</summary>
      <div class='why-panel'>${whyText}</div>
    </details>
  `;
  return card;
}

// A row for the "How does this compare?" chart. Your meal is highlighted.
function renderReferenceAnchors(diabetesScore, cvdScore) {
  const container = document.getElementById('anchor-bars');
  if (!container) return;

  const rows = REFERENCE_MEALS.map(function(m) {
    return { name: m.name, score: m.diabetes, yours: false };
  });
  rows.push({ name: 'Your meal', score: diabetesScore.score, yours: true });
  rows.sort(function(a, b) { return a.score - b.score; });

  container.innerHTML = rows.map(function(r) {
    return `
      <div class='anchor-row${r.yours ? ' your-meal' : ''}'>
        <span class='anchor-name'>${r.name}</span>
        <div class='anchor-bar-wrap'>
          <div class='anchor-bar-fill ${r.yours ? '' : bandBarClass(r.score)}'
            style='width: ${r.score}%'></div>
        </div>
        <span class='anchor-score'>${r.score}</span>
      </div>
    `;
  }).join('');
}

// Plain-text meal summary for the clipboard / print.
function buildScoreSummary(result, mealItems) {
  const d = result.diabetes;
  const c = result.cvd;
  const mealNames = mealItems
    .slice(0, 5)
    .map(function(item) {
      if (item.type === 'ingredient') return getIngredientById(item.id)?.name;
      if (item.type === 'dish') return getDishById(item.id)?.name;
      return 'Unknown';
    })
    .filter(Boolean)
    .join(', ');

  return [
    'South Asian Diet Risk Calculator',
    '────────────────────────────────',
    `Meal: ${mealNames}`,
    '',
    `Diabetes risk score: ${d.score}/100 (${d.band})`,
    `  Blood sugar spike: ${d.subScores.glycemic_load}/40 pts (GL ${d.gl.toFixed(1)})`,
    `  Refined carbs: ${d.subScores.refined_carb}/25 pts`,
    `  Fibre: ${d.subScores.fiber}/20 pts`,
    `  Protein quality: ${d.subScores.protein_quality}/15 pts`,
    '',
    `CVD risk score: ${c.score}/100 (${c.band})`,
    `  Saturated fat: ${c.subScores.saturated_fat}/40 pts`,
    `  Fat type balance: ${c.subScores.fat_quality ?? 'N/A'}/30 pts`,
    `  Fibre: ${c.subScores.fiber}/20 pts`,
    `  Sodium: ${c.subScores.sodium ?? 'N/A'}/10 pts`,
    '',
    'Scores are educational, not diagnostic.',
    'South Asian Diet Risk Calculator — github.com/obbhatt24-sudo/South-asian-diet-risk'
  ].join('\n');
}

// Collapsible per-dish nutrient breakdown, shown on each score card when the
// meal contains at least one dish item. Each row reuses the shared
// computeMealNutrients / computeMealGL helpers scoped to a single dish item.
function renderDishContributions(mealItems, scoreResult) {
  const dishItems = mealItems.filter(item => item.type === 'dish');
  if (dishItems.length === 0) return '';

  const rows = dishItems.map(item => {
    const dish = getDishById(item.id);
    if (!dish) return '';

    const servingG = dish.serving_size_g ||
      (dish.total_weight_g && dish.servings
        ? Math.round(dish.total_weight_g / dish.servings) : null);
    const totalG = servingG
      ? Math.round(servingG * item.servings) : null;

    // Compute this dish's nutrient contribution
    const dishNutrients = computeMealNutrients([item]);
    const dishGL = computeMealGL([item]);

    return `
      <div class='dish-contribution-row'>
        <div class='dish-contrib-name'>
          ${dish.name}
          ${totalG ? `<span class='dish-contrib-weight'>${totalG}g total</span>` : ''}
        </div>
        <div class='dish-contrib-stats'>
          <span>GL ${dishGL.toFixed(1)}</span>
          <span>Fiber ${dishNutrients.fiber_g.toFixed(1)}g</span>
          <span>Sat fat ${dishNutrients.saturated_fat_g.toFixed(1)}g</span>
          <span>Sodium ${Math.round(dishNutrients.sodium_mg)}mg</span>
        </div>
      </div>`;
  }).join('');

  return `
    <details class='dish-contributions'>
      <summary>Dish contributions to score</summary>
      <div class='dish-contrib-list'>${rows}</div>
    </details>`;
}

function renderResults(result, recs) {
  const container = document.getElementById('scores-container');
  container.innerHTML = '';

  const nutrients = computeMealNutrients(state.mealItems);
  const d = result.diabetes;
  const c = result.cvd;

  // Bridge meal-level nutrient values onto the score objects so the breakdown
  // rows can show real figures without changing scorer.js.
  d.fiberG = nutrients.fiber_g;
  c.satFatG = nutrients.saturated_fat_g;
  c.fiberG = nutrients.fiber_g;

  const diabetesNotes = [];
  if (mealUsedGiDefaults(state.mealItems)) {
    diabetesNotes.push('* GL estimated from food-group defaults for some ingredients.');
  }
  const dishContribHtml = renderDishContributions(state.mealItems, result);
  const diabetesCard = buildScoreCard(
    t('scores.diabetes_title'), d, t('scores.band_desc_' + d.band.toLowerCase()),
    renderDiabetesBreakdown(d), generateWhyText(d, 'diabetes'), diabetesNotes
  );
  if (dishContribHtml) diabetesCard.insertAdjacentHTML('beforeend', dishContribHtml);
  container.appendChild(diabetesCard);

  const diabetesRiskNote = document.createElement('p');
  diabetesRiskNote.className = 'risk-note';
  diabetesRiskNote.textContent = 'Note: South Asians are predisposed to greater ' +
    'visceral fat accumulation per unit of body weight — a risk factor not ' +
    'fully captured by meal-level scoring (ICMR-INDIAB, 2023).';
  container.appendChild(diabetesRiskNote);

  const cvdNotes = [];
  if (c.usedFallback) {
    cvdNotes.push('* Fat quality estimated from food-group data.');
  }
  const cvdCard = buildScoreCard(
    t('scores.cvd_title'), c, t('scores.band_desc_' + c.band.toLowerCase()),
    renderCvdBreakdown(c), generateWhyText(c, 'cvd'), cvdNotes
  );
  if (dishContribHtml) cvdCard.insertAdjacentHTML('beforeend', dishContribHtml);
  container.appendChild(cvdCard);

  const cvdRiskNote = document.createElement('p');
  cvdRiskNote.className = 'risk-note';
  cvdRiskNote.textContent = 'Note: approximately 25% of South Asians carry ' +
    'elevated Lp(a) lipoprotein — a genetic cardiovascular risk factor not ' +
    'modifiable by diet and not captured by this score. A low CVD score ' +
    'does not eliminate this baseline risk (MASALA Study; Tsimikas et al.).';
  container.appendChild(cvdRiskNote);

  // computeMealNutrients() flags meals containing USDA foods with unreported
  // nutrients (those read as null, summed as 0). Warn that scores for those
  // items may be understated.
  if (nutrients._hasIncompleteData) {
    const incompleteNote = document.createElement('p');
    incompleteNote.className = 'risk-note';
    incompleteNote.textContent = 'Some ingredients had incomplete nutrition ' +
      'data (marked N/A in the USDA database). Scores may be slightly ' +
      'understated for those items.';
    container.appendChild(incompleteNote);
  }

  renderReferenceAnchors(d, c);

  const copyBtn = document.getElementById('copy-score-btn');
  if (copyBtn) {
    copyBtn.textContent = t('scores.copy_summary');
    copyBtn.onclick = function() {
      navigator.clipboard.writeText(buildScoreSummary(result, state.mealItems))
        .then(function() {
          copyBtn.textContent = t('scores.copied');
          setTimeout(function() { copyBtn.textContent = t('scores.copy_summary'); }, 2000);
        });
    };
  }

  renderRecommendations(recs, result);
}

function renderRecommendations(recs, currentScores) {
  const container = document.getElementById('recommendations-container');
  container.innerHTML = '';

  if (recs.length === 0) {
    const none = document.createElement('div');
    none.className = 'no-recs';
    none.textContent = t('recommendations.no_recs');
    container.appendChild(none);
    return;
  }

  const heading = document.createElement('h3');
  heading.textContent = t('recommendations.heading');
  container.appendChild(heading);

  recs.forEach(function(rec, index) {
    const card = document.createElement('div');
    const isReduce = rec.intervention === 'reduce';
    card.className = isReduce ? 'rec-card rec-tip' : 'rec-card rec-swap';

    const badge = document.createElement('span');
    badge.className = 'rec-badge';
    badge.textContent = isReduce
      ? t('recommendations.tip_badge')
      : rec.intervention === 'replace'
        ? t('recommendations.swap_badge')
        : t('recommendations.add_badge');
    card.appendChild(badge);

    const instruction = document.createElement('p');
    instruction.className = 'rec-instruction';
    instruction.textContent = rec.instructionText;
    card.appendChild(instruction);

    const impact = document.createElement('div');
    impact.className = 'rec-impact';
    if (isReduce) {
      impact.textContent = t('recommendations.estimated_reduction',
        { name: rec.scoreName, delta: rec.delta });
      card.appendChild(impact);
    } else {
      impact.textContent = t('recommendations.score_drop', {
        name: rec.scoreName,
        from: currentScores[rec.scoreName].score,
        to: rec.previewScore
      });
      card.appendChild(impact);

      const applyBtn = document.createElement('button');
      applyBtn.className = 'apply-btn';
      applyBtn.id = 'apply-' + index;
      applyBtn.textContent = t('recommendations.apply');
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

// Renders the ML personal risk context panel. mlResult comes from
// getMLPersonalRiskContext(); passing null (or a failed load) clears the panel.
function renderMLContext(mlResult) {
  const panel = document.getElementById('ml-context-panel');
  if (!panel) return;

  if (!mlResult) {
    panel.innerHTML = '';
    return;
  }

  const bandClass = b => b.toLowerCase();

  panel.innerHTML = `
    <div class='ml-context-card'>
      <div class='ml-context-header'>
        <span class='ml-context-label'>Your personal risk context</span>
        <span class='ml-context-subtitle'>
          Based on your age, BMI, and activity level — independent of today's meal
        </span>
      </div>
      <div class='ml-context-scores'>
        <div class='ml-context-score-item'>
          <span class='ml-context-score-label'>Diabetes context</span>
          <span class='ml-context-score-value ${bandClass(mlResult.diabetes.band)}'>
            ${mlResult.diabetes.score}
          </span>
          <span class='ml-context-score-band'>${mlResult.diabetes.band}</span>
        </div>
        <div class='ml-context-score-item'>
          <span class='ml-context-score-label'>CVD context</span>
          <span class='ml-context-score-value ${bandClass(mlResult.cvd.band)}'>
            ${mlResult.cvd.score}
          </span>
          <span class='ml-context-score-band'>${mlResult.cvd.band}</span>
        </div>
      </div>
      <p class='ml-context-note'>
        These scores reflect where you sit in the risk distribution of similar
        South Asians based on population data (NHANES 2011–2018).
        A higher context score means your baseline risk is elevated —
        making dietary choices like this meal more impactful.
      </p>
      <details class='ml-context-info'>
        <summary>About this model</summary>
        <p>Trained on NHANES 2011–2018 dietary and health data.
        Validated on non-Hispanic Asian subsample:
        diabetes AUC ${mlResult.modelInfo.asianDiabetesAUC?.toFixed(3)},
        CVD AUC ${mlResult.modelInfo.asianCVDAUC?.toFixed(3)}.</p>
        <p>This is not a clinical risk assessment. Consult a healthcare
        provider for personal health decisions.</p>
      </details>
    </div>`;
}

async function saveMealToHistory() {
  const btn    = document.getElementById('save-meal-btn');
  const status = document.getElementById('save-meal-status');

  if (!isSignedIn()) {
    status.textContent = 'Sign in to save meals.';
    return;
  }

  if (!state._lastScoreResult) {
    status.textContent = 'No meal to save — calculate first.';
    return;
  }

  btn.disabled = true;
  btn.textContent = t('scores.saving');
  status.textContent = '';

  // Build a human-readable meal name from the top ingredients/dishes
  const topItems = state.mealItems.slice(0, 3).map(item => {
    if (item.type === 'ingredient') return getIngredientById(item.id)?.name || 'ingredient';
    if (item.type === 'dish') return getDishById(item.id)?.name || 'dish';
    return 'item';
  });
  const mealName = topItems.join(' + ') + (state.mealItems.length > 3 ? ' +more' : '');

  const result = state._lastScoreResult;

  const mealData = {
    meal_name:          mealName,
    context:            state.context,
    meal_items:         state.mealItems,
    diabetes_score:     result.diabetes.score,
    diabetes_band:      result.diabetes.band,
    cvd_score:          result.cvd.score,
    cvd_band:           result.cvd.band,
    diabetes_sub_scores: result.diabetes.subScores,
    cvd_sub_scores:     result.cvd.subScores,
    flags:              [...new Set([...result.diabetes.flags, ...result.cvd.flags])],
    recommendations:    state._lastRecs || [],
    personal_context:   state.personalContext,
    added_sodium_mg:    state.addedSodiumMg,
  };

  const { error } = await saveMeal(mealData);

  btn.disabled = false;
  btn.textContent = '💾 ' + t('scores.save_meal');

  if (error) {
    status.textContent = 'Error saving: ' + error.message;
    status.style.color = 'var(--color-high)';
  } else {
    status.textContent = '✓ Meal saved to your history';
    status.style.color = 'var(--color-low)';
    btn.textContent = '✓ ' + t('scores.saved');
    setTimeout(() => {
      btn.textContent = '💾 ' + t('scores.save_meal');
      status.textContent = '';
    }, 3000);
  }
}
