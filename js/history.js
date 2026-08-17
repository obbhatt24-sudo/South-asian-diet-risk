let _trendChart = null;

async function loadHistory() {
  const loading = document.getElementById('history-loading');
  const content = document.getElementById('history-content');
  const empty   = document.getElementById('history-empty');
  const errEl   = document.getElementById('history-error');

  loading.style.display = 'block';
  content.style.display = 'none';
  empty.style.display   = 'none';
  errEl.style.display   = 'none';

  const { data: meals, error } = await getRecentMeals(30);

  loading.style.display = 'none';

  if (error) {
    errEl.textContent = 'Could not load history: ' + error.message;
    errEl.style.display = 'block';
    return;
  }

  if (!meals || meals.length === 0) {
    empty.style.display = 'block';
    return;
  }

  content.style.display = 'block';
  renderPatternSummary(meals);
  renderCumulativeRisk(meals);
  renderTrendChart(meals);
  renderMealHistoryList(meals);
}

function renderCumulativeRisk(meals) {
  const panel = document.getElementById('cumulative-risk');
  if (!meals || meals.length < 14) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  // Sort oldest first for trend analysis
  const sorted = [...meals].sort((a, b) =>
    new Date(a.created_at) - new Date(b.created_at));

  // 7-day rolling averages
  function rollingAvg(arr, field, windowSize) {
    return arr.map((_, i) => {
      const start = Math.max(0, i - windowSize + 1);
      const window = arr.slice(start, i + 1);
      return window.reduce((s, m) => s + m[field], 0) / window.length;
    });
  }

  const dRolling = rollingAvg(sorted, 'diabetes_score', 7);
  const cRolling = rollingAvg(sorted, 'cvd_score', 7);

  // Overall averages — first half vs second half
  const half = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, half);
  const secondHalf = sorted.slice(half);

  const avgD1 = firstHalf.reduce((s,m) => s+m.diabetes_score,0)/firstHalf.length;
  const avgD2 = secondHalf.reduce((s,m) => s+m.diabetes_score,0)/secondHalf.length;
  const avgC1 = firstHalf.reduce((s,m) => s+m.cvd_score,0)/firstHalf.length;
  const avgC2 = secondHalf.reduce((s,m) => s+m.cvd_score,0)/secondHalf.length;

  const dTrend = avgD2 - avgD1;
  const cTrend = avgC2 - avgC1;

  function trendIcon(diff) {
    if (diff < -3) return '↓ Improving';
    if (diff > 3)  return '↑ Worsening';
    return '→ Stable';
  }
  function trendClass(diff) {
    if (diff < -3) return 'trend-improving';
    if (diff > 3)  return 'trend-worsening';
    return 'trend-stable';
  }

  // Cumulative impact statement
  const overallAvgD = sorted.reduce((s,m) => s+m.diabetes_score,0)/sorted.length;
  const overallAvgC = sorted.reduce((s,m) => s+m.cvd_score,0)/sorted.length;

  let impactStatement = '';
  if (overallAvgD >= 65 && overallAvgC >= 65) {
    impactStatement = `Your meals over this period have consistently contributed
      to elevated diabetes and cardiovascular risk factors. Sustained high
      dietary risk scores over weeks are associated with progressive insulin
      resistance and arterial inflammation in South Asian populations.`;
  } else if (overallAvgD >= 65 || overallAvgC >= 65) {
    const highScore = overallAvgD >= 65 ? 'diabetes' : 'cardiovascular';
    impactStatement = `Your ${highScore} risk factor scores have been
      consistently elevated across your recent meals. Even moderate persistent
      elevation in dietary risk scores is associated with gradual metabolic
      changes over months in South Asian populations.`;
  } else if (overallAvgD < 35 && overallAvgC < 35) {
    impactStatement = `Your meal patterns over this period show consistently
      low dietary risk scores — a strong indicator of protective dietary
      habits. Sustained low-risk dietary patterns are associated with
      significantly reduced T2D incidence in South Asian populations.`;
  } else {
    impactStatement = `Your meal patterns over this period show moderate
      dietary risk scores. Consistent moderate scores indicate room for
      improvement — small, sustainable dietary changes have the largest
      long-term impact on South Asian metabolic health.`;
  }

  // Count high-risk meal days
  const highRiskMeals = sorted.filter(m =>
    m.diabetes_score >= 65 || m.cvd_score >= 65).length;
  const highRiskPct = Math.round(highRiskMeals / sorted.length * 100);

  panel.innerHTML = `
    <div class='card-title'>Cumulative dietary risk</div>
    <div class='cumulative-stats'>
      <div class='cumulative-stat'>
        <span class='cumulative-label'>Avg diabetes score</span>
        <span class='cumulative-value'>${Math.round(overallAvgD)}</span>
        <span class='${trendClass(dTrend)}'>${trendIcon(dTrend)}</span>
      </div>
      <div class='cumulative-stat'>
        <span class='cumulative-label'>Avg CVD score</span>
        <span class='cumulative-value'>${Math.round(overallAvgC)}</span>
        <span class='${trendClass(cTrend)}'>${trendIcon(cTrend)}</span>
      </div>
      <div class='cumulative-stat'>
        <span class='cumulative-label'>High-risk meals</span>
        <span class='cumulative-value'>${highRiskPct}%</span>
        <span class='cumulative-sublabel'>of ${sorted.length} saved</span>
      </div>
    </div>
    <p class='cumulative-impact'>${impactStatement}</p>
    <p class='cumulative-note'>
      Based on ${sorted.length} saved meals.
      ${meals.length < 30 ? 'Save more meals for a more accurate picture.' : ''}
    </p>`;
}

function renderPatternSummary(meals) {
  const panel = document.getElementById('pattern-summary');
  if (!meals || meals.length < 3) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  // Average scores across all meals
  const avgD = Math.round(meals.reduce((s, m) => s + m.diabetes_score, 0) / meals.length);
  const avgC = Math.round(meals.reduce((s, m) => s + m.cvd_score, 0) / meals.length);
  const dBand = avgD < 35 ? 'Low' : avgD < 65 ? 'Moderate' : 'High';
  const cBand = avgC < 35 ? 'Low' : avgC < 65 ? 'Moderate' : 'High';

  // Most consistently fired flag
  const flagCounts = {};
  meals.forEach(m => (m.flags || []).forEach(f => {
    flagCounts[f] = (flagCounts[f] || 0) + 1;
  }));
  const topFlag = Object.entries(flagCounts)
    .sort((a, b) => b[1] - a[1])[0];

  const flagLabels = {
    high_glycemic_load:      'high glycemic load (blood sugar spikes)',
    high_refined_carb_share: 'high refined carbohydrate share',
    low_fiber:               'low dietary fibre',
    poor_protein_quality:    'low quality protein sources',
    high_saturated_fat:      'high saturated fat',
    poor_fat_quality:        'poor fat type balance',
    high_sodium:             'high sodium',
  };

  // Week-over-week comparison
  const now = Date.now();
  const week1 = meals.filter(m => now - new Date(m.created_at) < 7*24*3600*1000);
  const week2 = meals.filter(m => {
    const age = now - new Date(m.created_at);
    return age >= 7*24*3600*1000 && age < 14*24*3600*1000;
  });

  let trendHTML = '';
  if (week1.length >= 2 && week2.length >= 2) {
    const w1AvgD = Math.round(week1.reduce((s,m) => s+m.diabetes_score,0)/week1.length);
    const w2AvgD = Math.round(week2.reduce((s,m) => s+m.diabetes_score,0)/week2.length);
    const diff = w2AvgD - w1AvgD;
    if (diff > 3) {
      trendHTML = `<p class='pattern-trend improved'>
        ↓ Diabetes score improved by ${diff} points vs last week.</p>`;
    } else if (diff < -3) {
      trendHTML = `<p class='pattern-trend worsened'>
        ↑ Diabetes score increased by ${Math.abs(diff)} points vs last week.</p>`;
    } else {
      trendHTML = `<p class='pattern-trend stable'>
        → Scores are stable week-over-week.</p>`;
    }
  }

  panel.innerHTML = `
    <div class='card-title'>Your meal patterns</div>
    <div class='pattern-averages'>
      <div class='pattern-avg-item'>
        <span class='pattern-avg-label'>Avg diabetes score</span>
        <span class='pattern-avg-value ${dBand.toLowerCase()}'>${avgD}</span>
        <span class='pattern-avg-band'>${dBand}</span>
      </div>
      <div class='pattern-avg-item'>
        <span class='pattern-avg-label'>Avg CVD score</span>
        <span class='pattern-avg-value ${cBand.toLowerCase()}'>${avgC}</span>
        <span class='pattern-avg-band'>${cBand}</span>
      </div>
    </div>
    ${topFlag ? `
    <p class='pattern-flag'>
      Most consistent risk factor across your meals:
      <strong>${flagLabels[topFlag[0]] || topFlag[0]}</strong>
      (flagged in ${topFlag[1]} of ${meals.length} meals).
    </p>` : ''}
    ${trendHTML}
  `;
}

function renderTrendChart(meals) {
  // meals are newest-first; reverse for chart (oldest left)
  const sorted = [...meals].reverse();
  const labels = sorted.map(m => {
    const d = new Date(m.created_at);
    return d.toLocaleDateString('en-IN', { month:'short', day:'numeric' });
  });

  const ctx = document.getElementById('trend-chart').getContext('2d');
  if (_trendChart) _trendChart.destroy();

  _trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Diabetes score',
          data: sorted.map(m => m.diabetes_score),
          borderColor: '#E65100',
          backgroundColor: 'rgba(230,81,0,0.08)',
          tension: 0.3, pointRadius: 4, fill: true,
        },
        {
          label: 'CVD score',
          data: sorted.map(m => m.cvd_score),
          borderColor: '#1565C0',
          backgroundColor: 'rgba(21,101,192,0.08)',
          tension: 0.3, pointRadius: 4, fill: true,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Inter' } } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const meal = sorted[items[0].dataIndex];
              return ['Meal: ' + (meal.meal_name || 'Unnamed')];
            }
          }
        }
      },
      scales: {
        y: { min: 0, max: 100,
          ticks: { font: { family: 'Inter', size: 11 } }
        },
        x: { ticks: { font: { family: 'Inter', size: 10 },
          maxRotation: 45 } }
      }
    }
  });
}

function renderMealHistoryList(meals) {
  const list = document.getElementById('meal-history-list');
  list.innerHTML = meals.map((m, i) => {
    const date = new Date(m.created_at).toLocaleDateString('en-IN', {
      weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
    });
    const dBand = m.diabetes_band.toLowerCase();
    const cBand = m.cvd_band.toLowerCase();
    const flags = (m.flags || []).slice(0, 3).join(', ') || 'None';

    return `
      <div class='history-item card'>
        <div class='history-item-header'>
          <div class='history-item-name'>
            ${m.meal_name || 'Unnamed meal'}
            <span class='history-item-date'>${date}</span>
          </div>
          <div class='history-item-scores'>
            <span class='history-score ${dBand}'>D: ${m.diabetes_score}</span>
            <span class='history-score ${cBand}'>C: ${m.cvd_score}</span>
          </div>
        </div>
        <div class='history-item-flags'>Flags: ${flags}</div>
        <div class='history-item-actions'>
          <button onclick='toggleHistoryDetail("hd-${i}")'>
            ▼ Full detail
          </button>
          <button onclick='reloadMeal(${JSON.stringify(JSON.stringify(m))})'>
            ↩ Reload in builder
          </button>
          <button onclick='deleteHistoryMeal("${m.id}", this)'
                  style='color:var(--color-high)'>
            Delete
          </button>
        </div>
        <div id='hd-${i}' class='history-detail' style='display:none'>
          <pre class='history-json'>
${JSON.stringify({ ingredients: m.meal_items, diabetesSubScores: m.diabetes_sub_scores, cvdSubScores: m.cvd_sub_scores }, null, 2)}
          </pre>
        </div>
      </div>`;
  }).join('');
}

function toggleHistoryDetail(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function reloadMeal(mealJsonStr) {
  const meal = JSON.parse(mealJsonStr);
  state.mealItems = meal.meal_items || [];
  state.context   = meal.context || 'india';
  state.personalContext = meal.personal_context || state.personalContext;
  state.addedSodiumMg   = meal.added_sodium_mg || null;
  renderMealItems();
  updateNutrientTotals();
  updateCalculateButton();
  showView('meal-builder');
}

async function deleteHistoryMeal(mealId, btn) {
  if (!confirm('Delete this meal from history?')) return;
  btn.disabled = true;
  const { error } = await deleteMeal(mealId);
  if (error) {
    alert('Could not delete: ' + error.message);
    btn.disabled = false;
  } else {
    loadHistory();  // refresh
  }
}
