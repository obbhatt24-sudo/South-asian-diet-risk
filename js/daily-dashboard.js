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
    fiber_g: 0, sodium_mg: 0, saturated_fat_g: 0, sugars_g: 0
  };

  todayMeals.forEach(meal => {
    const items = meal.meal_items || [];
    const nutrients = computeMealNutrients(items);
    totals.energy_kcal    += nutrients.energy_kcal || 0;
    totals.carb_g         += nutrients.carbohydrate_g || 0;
    totals.protein_g      += nutrients.protein_g || 0;
    totals.fat_g          += nutrients.total_fat_g || 0;
    totals.fiber_g        += nutrients.fiber_g || 0;
    totals.sodium_mg      += (nutrients.sodium_mg || 0) +
                             (meal.added_sodium_mg || 0);
    totals.saturated_fat_g += nutrients.saturated_fat_g || 0;
    totals.sugars_g       += nutrients.sugars_g || 0;
  });

  // Daily targets (South Asian adult — approximate)
  const targets = {
    energy_kcal: 2000, carb_g: 250, protein_g: 60,
    fat_g: 65, fiber_g: 30, sodium_mg: 2000,
    saturated_fat_g: 20, sugars_g: 30
  };

  function pct(value, target) {
    return Math.min(100, Math.round(value / target * 100));
  }
  function barColor(p) {
    return p < 70 ? 'var(--color-low)'
      : p < 100 ? 'var(--color-moderate)' : 'var(--color-high)';
  }

  const nutrients = [
    { label: 'Calories', value: Math.round(totals.energy_kcal),
      unit: 'kcal', target: targets.energy_kcal },
    { label: 'Carbohydrates', value: Math.round(totals.carb_g),
      unit: 'g', target: targets.carb_g },
    { label: 'Protein', value: Math.round(totals.protein_g),
      unit: 'g', target: targets.protein_g },
    { label: 'Fat', value: Math.round(totals.fat_g),
      unit: 'g', target: targets.fat_g },
    { label: 'Fibre', value: Math.round(totals.fiber_g),
      unit: 'g', target: targets.fiber_g },
    { label: 'Sodium', value: Math.round(totals.sodium_mg),
      unit: 'mg', target: targets.sodium_mg },
    { label: 'Saturated fat', value: Math.round(totals.saturated_fat_g * 10)/10,
      unit: 'g', target: targets.saturated_fat_g },
    { label: 'Sugars', value: Math.round(totals.sugars_g),
      unit: 'g', target: targets.sugars_g },
  ];

  // Macro ring chart (simple CSS)
  const carbCal  = totals.carb_g * 4;
  const protCal  = totals.protein_g * 4;
  const fatCal   = totals.fat_g * 9;
  const totalCal = carbCal + protCal + fatCal || 1;
  const carbPct  = Math.round(carbCal / totalCal * 100);
  const protPct  = Math.round(protCal / totalCal * 100);
  const fatPct   = Math.round(fatCal  / totalCal * 100);

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
      ${nutrients.map(n => {
        const p = pct(n.value, n.target);
        return `
          <div class='nutrient-row'>
            <span class='nutrient-name'>${n.label}</span>
            <div class='nutrient-bar-wrap'>
              <div class='nutrient-bar-fill'
                   style='width:${p}%;background:${barColor(p)}'></div>
            </div>
            <span class='nutrient-value'>${n.value}${n.unit}</span>
            <span class='nutrient-target'>/ ${n.target}${n.unit}</span>
          </div>`;
      }).join('')}
    </div>
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
