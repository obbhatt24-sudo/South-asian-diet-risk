const state = {
  context: 'india',
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
  ['meal-builder', 'results', 'about'].forEach(function(viewId) {
    document.getElementById(viewId).style.display = viewId === id ? 'block' : 'none';
  });
  document.querySelectorAll('nav button').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.view === id);
  });
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
  loadExplanation(result, recs, state.mealItems);
  getMLPersonalRiskContext(state.personalContext, state.mealItems, state.addedSodiumMg)
    .then(mlResult => renderMLContext(mlResult));
  showView('results');
});

document.querySelectorAll('input[name="context"]').forEach(function(radio) {
  radio.addEventListener('change', function() {
    state.context = radio.value;
    document.getElementById('context-description').textContent = CONTEXT_DESCRIPTIONS[radio.value];
  });
});

document.getElementById('salt-input').addEventListener('change', function() {
  state.addedSodiumMg = this.value !== 'null' ? parseInt(this.value, 10) : null;
});

document.getElementById('bmi-input').addEventListener('change', function() {
  state.personalContext.bmiCategory = this.value;
});

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
state.personalContext.age = 40;
state.personalContext.sedentaryHrs = 6;

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

function initUI() {
  initAuth();
  loadData().then(() => { console.log('Data loaded'); enableUI(); });
  showView('meal-builder');
  document.getElementById('context-description').textContent = CONTEXT_DESCRIPTIONS['india'];
  document.getElementById('cache-counter').textContent =
    `${getScanCacheSize()} products in local database`;
  console.log('App initialised, state:', state);
}

initUI();
