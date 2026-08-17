// Nutrient metadata used only for rendering (labels, units, decimal places).
// Field order here also drives display order.
const MACRO_ROW_META = [
  { key: 'energy_kcal',     label: 'Calories',       unit: 'kcal', decimals: 0 },
  { key: 'carb_g',          label: 'Carbohydrates',  unit: 'g',    decimals: 0 },
  { key: 'protein_g',       label: 'Protein',        unit: 'g',    decimals: 0 },
  { key: 'fat_g',           label: 'Fat',             unit: 'g',    decimals: 0 },
  { key: 'fiber_g',         label: 'Fibre',           unit: 'g',    decimals: 0 },
  { key: 'sodium_mg',       label: 'Sodium',          unit: 'mg',   decimals: 0 },
  { key: 'saturated_fat_g', label: 'Saturated fat',   unit: 'g',    decimals: 1 },
  { key: 'sugars_g',        label: 'Sugars',          unit: 'g',    decimals: 0 },
];
const MICRO_ROW_META = [
  { key: 'iron_mg',         label: 'Iron',            unit: 'mg',  decimals: 1 },
  { key: 'calcium_mg',      label: 'Calcium',         unit: 'mg',  decimals: 0 },
  { key: 'zinc_mg',         label: 'Zinc',            unit: 'mg',  decimals: 1 },
  { key: 'folate_µg',       label: 'Folate (B9)',     unit: 'µg',  decimals: 0 },
  { key: 'b12_µg',          label: 'Vitamin B12',     unit: 'µg',  decimals: 1 },
  { key: 'vitamin_d_µg',    label: 'Vitamin D',       unit: 'µg',  decimals: 1 },
  { key: 'vitamin_a_re_µg', label: 'Vitamin A',       unit: 'µg',  decimals: 0 },
  { key: 'vitamin_c_mg',    label: 'Vitamin C',       unit: 'mg',  decimals: 0 },
  { key: 'potassium_mg',    label: 'Potassium',       unit: 'mg',  decimals: 0 },
  { key: 'magnesium_mg',    label: 'Magnesium',       unit: 'mg',  decimals: 0 },
];

function mergeConfidence(currentLevel, newLevel) {
  return CONFIDENCE_RANK[newLevel] < CONFIDENCE_RANK[currentLevel] ? newLevel : currentLevel;
}

async function loadTodayDashboard() {
  if (!isSignedIn()) {
    document.getElementById('today-content').innerHTML =
      '<p>Sign in to track your daily nutrition.</p>';
    return;
  }

  // Get today's meals from Supabase
  const today = new Date().toISOString().slice(0, 10);
  const { data: allMeals } = await getRecentMeals(30);
  const todayMeals = (allMeals || []).filter(m =>
    m.created_at.slice(0, 10) === today
  );

  if (!todayMeals.length) {
    document.getElementById('today-content').innerHTML = `
      <p class='empty-state'>No meals saved today yet.</p>
      <p class='empty-state'>Save a meal from the Results page to track it here.</p>`;
    return;
  }

  // Compute totals from all today's meals
  const totals = {
    energy_kcal: 0, carb_g: 0, protein_g: 0, fat_g: 0,
    fiber_g: 0, sodium_mg: 0, saturated_fat_g: 0, sugars_g: 0,
  };
  MICRONUTRIENT_FIELDS.forEach(field => { totals[field] = 0; });
  const microConfidence = {};
  MICRONUTRIENT_FIELDS.forEach(field => { microConfidence[field] = 'high'; });

  let anyNonVeg = false;
  let plantIronMg = 0;

  todayMeals.forEach(meal => {
    const items = meal.meal_items || [];
    const nutrients = computeMealNutrients(items);
    totals.energy_kcal    += nutrients.energy_kcal || 0;
    totals.carb_g          += nutrients.carbohydrate_g || 0;
    totals.protein_g       += nutrients.protein_g || 0;
    totals.fat_g           += nutrients.total_fat_g || 0;
    totals.fiber_g          += nutrients.fiber_g || 0;
    totals.sodium_mg      += (nutrients.sodium_mg || 0) +
                             (meal.added_sodium_mg || 0);
    totals.saturated_fat_g += nutrients.saturated_fat_g || 0;
    totals.sugars_g        += nutrients.sugars_g || 0;

    MICRONUTRIENT_FIELDS.forEach(field => {
      const level = nutrients._microConfidence ? nutrients._microConfidence[field] : 'unknown';
      microConfidence[field] = mergeConfidence(microConfidence[field], level);
      // Only count this meal's contribution when it's not built on unreported
      // data — otherwise a meal with missing micronutrient data would quietly
      // understate the daily total instead of just being flagged as unknown.
      if (level !== 'unknown') totals[field] += nutrients[field] || 0;
    });

    const hasNonVeg = items.some(item => {
      if (item.type !== 'ingredient') return false;
      const ing = getIngredientById(item.id);
      return ing && ing.diet_type === 'non_veg';
    });
    if (hasNonVeg) anyNonVeg = true;
    else plantIronMg += nutrients.iron_mg || 0;
  });

  // ICMR-NIN 2020 Recommended Dietary Allowances for Indians
  const isMale = state.personalContext.sex !== 'female';
  const targets = {
    energy_kcal:     isMale ? 2110 : 1660,
    carb_g:          130,
    protein_g:       isMale ? 54 : 46,
    fat_g:           isMale ? 63 : 50,
    fiber_g:         isMale ? 40 : 32,
    sodium_mg:       2000,
    saturated_fat_g: isMale ? 21 : 17,
    sugars_g:        50,
    iron_mg:         isMale ? 17 : 21,
    calcium_mg:      1000,
    zinc_mg:         isMale ? 17 : 13,
    folate_µg:       200,
    b12_µg:          2.0,
    vitamin_d_µg:    15,
    vitamin_a_re_µg: isMale ? 1000 : 840,
    vitamin_c_mg:    65,
    potassium_mg:    3500,
    magnesium_mg:    isMale ? 340 : 310,
  };

  function barColor(p) {
    return p < 70 ? 'var(--color-low)'
      : p < 100 ? 'var(--color-moderate)' : 'var(--color-high)';
  }

  function renderNutrientRow(label, value, unit, target, confidence, decimals) {
    const isUnknown = confidence === 'unknown' || value === null;
    const displayValue = isUnknown ? '—'
      : confidence === 'low' ? `~${Math.round(value * 10 ** decimals) / 10 ** decimals}`
      : String(Math.round(value * 10 ** decimals) / 10 ** decimals);
    const pct = isUnknown ? 0 : Math.min(100, value / target * 100);
    const barStyle = isUnknown ? 'background: #eee; border: 1px dashed #ccc'
      : confidence === 'low' ? `background:${barColor(pct)};opacity: 0.6`
      : `background:${barColor(pct)}`;

    return `
      <div class='nutrient-row ${isUnknown ? 'nutrient-unknown' : ''}'>
        <span class='nutrient-name'>
          ${label}
          ${confidence === 'low' ? '<span class="confidence-low">*</span>' : ''}
          ${isUnknown ? '<span class="confidence-unknown">?</span>' : ''}
        </span>
        <div class='nutrient-bar-wrap'>
          <div class='nutrient-bar-fill' style='width:${pct}%;${barStyle}'></div>
        </div>
        <span class='nutrient-value'>${displayValue}${isUnknown ? '' : unit}</span>
        <span class='nutrient-target'>/ ${target}${unit}</span>
      </div>`;
  }

  const macroRowsHTML = MACRO_ROW_META.map(meta =>
    renderNutrientRow(meta.label, totals[meta.key], meta.unit, targets[meta.key], 'high', meta.decimals)
  ).join('');

  const microRowsHTML = MICRO_ROW_META.map(meta =>
    renderNutrientRow(meta.label, totals[meta.key], meta.unit, targets[meta.key],
      microConfidence[meta.key], meta.decimals)
  ).join('');

  // Macro ring chart (simple CSS)
  const carbCal  = totals.carb_g * 4;
  const protCal  = totals.protein_g * 4;
  const fatCal   = totals.fat_g * 9;
  const totalCal = carbCal + protCal + fatCal || 1;
  const carbPct  = Math.round(carbCal / totalCal * 100);
  const protPct  = Math.round(protCal / totalCal * 100);
  const fatPct   = Math.round(fatCal  / totalCal * 100);

  // Iron bioavailability note — only when the day's meals are entirely
  // plant-based and iron intake is high enough that absorption efficiency
  // actually matters to the reader.
  const showIronNote = !anyNonVeg && plantIronMg >= targets.iron_mg * 0.5;
  const ironNoteHTML = showIronNote ? `
    <p class='bioavailability-note'>
      Note: Iron from plant foods (non-haem iron) is absorbed at
      5-12% efficiency vs 25-35% for meat sources.
      Consuming vitamin C-rich foods with iron-rich plant foods
      (e.g. lemon juice on dal) can double iron absorption.
    </p>` : '';

  document.getElementById('today-content').innerHTML = `
    <div class='daily-header'>
      <div class='daily-calories'>
        <span class='daily-cal-value'>${Math.round(totals.energy_kcal)}</span>
        <span class='daily-cal-label'>kcal today</span>
        <span class='daily-cal-target'>of ${targets.energy_kcal} target</span>
      </div>
      <div class='macro-split'>
        <div class='macro-bar'>
          <div class='macro-carb' style='width:${carbPct}%'></div>
          <div class='macro-prot' style='width:${protPct}%'></div>
          <div class='macro-fat'  style='width:${fatPct}%'></div>
        </div>
        <div class='macro-legend'>
          <span class='legend-carb'>Carbs ${carbPct}%</span>
          <span class='legend-prot'>Protein ${protPct}%</span>
          <span class='legend-fat'>Fat ${fatPct}%</span>
        </div>
      </div>
    </div>
    <div class='nutrient-list'>
      ${macroRowsHTML}
    </div>
    <h3 class='micro-heading'>Micronutrients</h3>
    <div class='nutrient-list'>
      ${microRowsHTML}
    </div>
    <p class='confidence-footnote'>
      * Estimated value — treat as approximate.
      ? No data available for this nutrient in one or more foods.
      Targets from ICMR-NIN 2020 Recommended Dietary Allowances for Indians.
    </p>
    ${ironNoteHTML}
    <div class='daily-meals-list'>
      <h3>Meals today (${todayMeals.length})</h3>
      ${todayMeals.map(m => `
        <div class='daily-meal-item'>
          <span>${m.meal_name || 'Unnamed meal'}</span>
          <span class='daily-meal-scores'>
            D:${m.diabetes_score} C:${m.cvd_score}
          </span>
        </div>`).join('')}
    </div>
    <p class='daily-disclaimer'>
      Targets are approximate for a South Asian adult.
      Adjust based on your personal requirements.
    </p>`;
}
