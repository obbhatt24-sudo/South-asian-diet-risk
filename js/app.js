const state = {
  context: 'india',
  baseContext: 'india', // last-selected India/US context; restored when the T1D toggle is unchecked
  mealItems: [],
  personalContext: {
    bmiCategory: 'normal',
    t2dFamilyHistory: null,
    cvdFamilyHistory: null
  },
  addedSodiumMg: null
};

const CONTEXT_DESCRIPTIONS = {
  india: 'Risk based on dietary patterns typical in India, where refined cereals and low protein intake are primary drivers (ICMR-INDIAB).',
  us:    'Risk based on dietary patterns of South Asians in the US, where physical inactivity and dietary fat quality are additional documented risk factors (MASALA Study).'
};

function showView(id) {
  ['meal-builder', 'results', 'about', 'history', 'pantry', 'today', 'learn-more'].forEach(function(viewId) {
    document.getElementById(viewId).style.display = viewId === id ? 'block' : 'none';
  });
  document.querySelectorAll('nav button').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.view === id);
  });
  if (id === 'history' && isSignedIn()) loadHistory();
  if (id === 'pantry') loadPantry();
  if (id === 'today') loadTodayDashboard();
  if (id === 'learn-more') initLearnMore();
}

document.querySelectorAll('[data-view]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    showView(btn.dataset.view);
  });
});

document.getElementById('back-btn').addEventListener('click', function() {
  showView('meal-builder');
});

document.getElementById('calculate-btn').addEventListener('click', function() {
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
  _lastScoreResult = result;
  _lastRecs = recs;
  _lastMealItems = [...state.mealItems];
  state._lastScoreResult = result;
  state._lastRecs = recs;
  loadExplanation(result, recs, state.mealItems);
  getMLPersonalRiskContext(state.personalContext, state.mealItems, state.addedSodiumMg)
    .then(mlResult => renderMLContext(mlResult));
  showView('results');
});

document.querySelectorAll('input[name="context"]').forEach(function(radio) {
  radio.addEventListener('change', function() {
    state.baseContext = radio.value;
    const t1dToggle = document.getElementById('t1d-toggle');
    // A T1D toggle already checked stays in T1D mode — India/US only sets
    // the population context used for framing, not the T1D scoring mode.
    if (!t1dToggle || !t1dToggle.checked) {
      state.context = radio.value;
      document.getElementById('context-description').textContent =
        typeof t === 'function' ? t(`context.${radio.value}_description`) : CONTEXT_DESCRIPTIONS[radio.value];
    }
  });
});

document.getElementById('salt-input').addEventListener('change', function() {
  state.addedSodiumMg = this.value !== 'null' ? parseInt(this.value, 10) : null;
  updateNutrientTotals();
});

function updateBMI() {
  const heightCm = parseFloat(document.getElementById('height-cm').value);
  const weightKg = parseFloat(document.getElementById('weight-kg').value);

  if (!heightCm || !weightKg) {
    document.getElementById('bmi-display').style.display = 'none';
    return;
  }

  const bmi = weightKg / Math.pow(heightCm / 100, 2);
  const bmiRounded = Math.round(bmi * 10) / 10;

  // Asian BMI cutoffs (WHO/SEARO)
  let category, categoryLabel, categoryClass;
  if (bmi < 18.5) {
    category = 'underweight'; categoryLabel = 'Underweight'; categoryClass = 'bmi-low';
  } else if (bmi < 23) {
    category = 'normal'; categoryLabel = 'Normal'; categoryClass = 'bmi-normal';
  } else if (bmi < 25) {
    category = 'overweight'; categoryLabel = 'Overweight (Asian)'; categoryClass = 'bmi-warning';
  } else {
    category = 'obese'; categoryLabel = 'Obese (Asian)'; categoryClass = 'bmi-high';
  }

  // Waist-to-height ratio if waist is entered
  const waistCm = parseFloat(document.getElementById('waist-input')?.value);
  let whrText = '';
  if (waistCm && heightCm) {
    const whr = waistCm / heightCm;
    const whrRisk = whr >= 0.5 ? 'elevated risk' : 'normal';
    whrText = `  |  Waist-to-height ratio: ${whr.toFixed(2)} (${whrRisk})`;
  }

  // Update display
  document.getElementById('bmi-display').style.display = 'block';
  document.getElementById('bmi-value').textContent = bmiRounded.toFixed(1);
  document.getElementById('bmi-category-label').textContent = categoryLabel;
  document.getElementById('bmi-category-label').className = categoryClass;
  document.getElementById('whr-display').textContent = whrText;

  // Update state
  state.personalContext.bmi = bmiRounded;
  state.personalContext.bmiCategory = category;
  state.personalContext.heightCm = heightCm;
  state.personalContext.weightKg = weightKg;
}

document.getElementById('t2d-history').addEventListener('change', function() {
  state.personalContext.t2dFamilyHistory =
    this.value === 'yes' ? true : this.value === 'no' ? false : null;
});

document.getElementById('cvd-history').addEventListener('change', function() {
  state.personalContext.cvdFamilyHistory =
    this.value === 'yes' ? true : this.value === 'no' ? false : null;
});

document.getElementById('age-input').addEventListener('input', function(e) {
  state.personalContext.age = parseInt(e.target.value) || 40;
});
document.getElementById('sedentary-input').addEventListener('change', function(e) {
  state.personalContext.sedentaryHrs = parseInt(e.target.value);
});
document.getElementById('waist-input').addEventListener('input', e => {
  state.personalContext.waistCm = parseInt(e.target.value) || null;
  updateBMI();
});
state.personalContext.age = 40;
state.personalContext.sedentaryHrs = 6;
state.personalContext.waistCm = null;
state.personalContext.sex = 'male';

// Search-source tabs: each entry pairs a tab button with the panel it controls.
const SEARCH_TABS = [
  { tab: 'tab-ingredient', panel: 'ingredient-search-panel' },
  { tab: 'tab-dish',       panel: 'dish-search-panel' },
  { tab: 'tab-packaged',   panel: 'packaged-search-panel' },
  { tab: 'tab-scan',       panel: 'scan-panel' }
];

function selectSearchTab(activeTabId) {
  SEARCH_TABS.forEach(function(entry) {
    const isActive = entry.tab === activeTabId;
    const tabBtn = document.getElementById(entry.tab);
    tabBtn.classList.toggle('active', isActive);
    tabBtn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    document.getElementById(entry.panel).style.display = isActive ? 'block' : 'none';
  });
}

SEARCH_TABS.forEach(function(entry) {
  document.getElementById(entry.tab).addEventListener('click', function() {
    selectSearchTab(entry.tab);
    // The Scan tab drives the camera: start it on entry, and stop it whenever
    // the user switches to any other search source.
    if (entry.tab === 'tab-scan') {
      startScanner();
    } else {
      stopScanner();
    }
  });
});

document.getElementById('stop-scanner').addEventListener('click', function() {
  stopScanner();
});

function enableUI() {
  console.log('UI ready');
  initMealBuilder();
}

async function initUI() {
  await initI18n();
  initAuth();
  loadData().then(() => { console.log('Data loaded'); enableUI(); });
  showView('meal-builder');
  document.getElementById('context-description').textContent =
    t(`context.${state.context}_description`);
  document.getElementById('cache-counter').textContent =
    `${getScanCacheSize()} products in local database`;
  applyTranslations();
  console.log('App initialised, state:', state);
}

initUI();
