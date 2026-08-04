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
  renderTrendChart(meals);
  renderMealHistoryList(meals);
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
