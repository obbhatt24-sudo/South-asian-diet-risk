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
}

document.querySelectorAll('[data-view]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    showView(btn.dataset.view);
  });
});

document.getElementById('back-btn').addEventListener('click', function() {
  showView('meal-builder');
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

document.getElementById('tab-ingredient').addEventListener('click', function() {
  document.getElementById('ingredient-search-panel').style.display = 'block';
  document.getElementById('dish-search-panel').style.display = 'none';
  document.getElementById('tab-ingredient').classList.add('active');
  document.getElementById('tab-dish').classList.remove('active');
});

document.getElementById('tab-dish').addEventListener('click', function() {
  document.getElementById('dish-search-panel').style.display = 'block';
  document.getElementById('ingredient-search-panel').style.display = 'none';
  document.getElementById('tab-dish').classList.add('active');
  document.getElementById('tab-ingredient').classList.remove('active');
});

function enableUI() {
  console.log('UI ready');
  initMealBuilder();
}

function initUI() {
  loadData().then(() => { console.log('Data loaded'); enableUI(); });
  showView('meal-builder');
  document.getElementById('context-description').textContent = CONTEXT_DESCRIPTIONS['india'];
  console.log('App initialised, state:', state);
}

initUI();
