const DIET_BADGE = {
  veg:     { label: 'veg',     color: 'green'  },
  egg:     { label: 'egg',     color: '#b8860b' },
  non_veg: { label: 'non-veg', color: 'red'    }
};

// Last dish search query and non-veg inclusion flag, remembered so the serving
// prompt's Cancel button can restore the dish results it replaced.
let _lastDishQuery = '';
let _includeNonVeg = false;

// Products shown in the Packaged/Scan panels, cached by product.id so the
// deep-dive ingredient analysis can resolve a product from its button's id.
// Populated by renderPackagedResults (searched) and showScannedProduct (scanned).
const _scannedProductCache = {};   // product.id -> scanned product
const _searchedProductCache = {};  // product.id -> searched product

function renderIngredientResults(results, query) {
  const container = document.getElementById('ingredient-results');
  container.innerHTML = '';

  if (query.length < 2) {
    return;
  }

  if (results.length === 0) {
    container.innerHTML = `<p class='empty-state'>No ingredients found matching "${query}". Try a different spelling.</p>`;
    return;
  }

  results.forEach(function(ingredient) {
    const div = document.createElement('div');
    div.className = 'ingredient-result';
    div.style.cursor = 'pointer';

    const badge = DIET_BADGE[ingredient.diet_type] || { label: ingredient.diet_type, color: 'gray' };

    div.innerHTML =
      '<strong>' + ingredient.name + '</strong> ' +
      '<span style="color:' + badge.color + '; font-size:0.85em;">' + badge.label + '</span> ' +
      '<span style="font-size:0.8em; color:#666;">' + ingredient.food_group + '</span>';

    div.addEventListener('click', function() {
      promptGramAmount(ingredient, div);
    });

    container.appendChild(div);
  });
}

// Append USDA fallback results below the local results, separated by a
// divider. USDA foods show a 'USDA' badge instead of a diet_type badge and,
// once clicked, are registered so they resolve like local ingredients.
function appendUSDAResults(foods, query) {
  const container = document.getElementById('ingredient-results');
  if (!container || !foods || foods.length === 0) return;

  // Guard against stale async: only append if the search box still shows the
  // query these results were fetched for.
  const searchInput = document.getElementById('ingredient-search');
  if (!searchInput || searchInput.value.trim() !== query) return;

  const divider = document.createElement('div');
  divider.className = 'results-divider';
  divider.textContent = 'More foods (USDA)';
  container.appendChild(divider);

  foods.forEach(function(food) {
    const div = document.createElement('div');
    div.className = 'ingredient-result';
    div.style.cursor = 'pointer';

    div.innerHTML =
      '<strong>' + food.name + '</strong> ' +
      '<span class="diet-badge usda-badge">USDA</span> ' +
      '<span style="font-size:0.8em; color:#666;">' + food.food_group + '</span>';

    div.addEventListener('click', function() {
      registerExternalIngredient(food);
      promptGramAmount(food, div);
    });

    container.appendChild(div);
  });
}

// Nutri-Score (a–e) and NOVA group (1–4) badges for Open Food Facts products.
// Return '' when the value is missing so the badge simply doesn't appear.
function nutriScoreBadgeHtml(grade) {
  if (!grade) return '';
  const g = String(grade).toLowerCase();
  return '<span class="diet-badge nutriscore-' + g + '">Nutri-Score ' +
    g.toUpperCase() + '</span>';
}

function novaBadgeHtml(nova) {
  if (nova === null || nova === undefined || nova === '') return '';
  const n = String(nova);
  return '<span class="diet-badge nova-badge nova-' + n + '">NOVA ' + n + '</span>';
}

// Render Open Food Facts results into the Packaged panel. Products carry the
// ingredient schema, so a click registers them (like USDA) and reuses the
// shared gram-amount prompt.
function renderPackagedResults(results, query) {
  const container = document.getElementById('packaged-results');
  container.innerHTML = '';

  if (query.length < 2) {
    return;
  }

  if (results.length === 0) {
    container.innerHTML = `<p class='empty-state'>No packaged foods found matching "${query}". Try a different spelling or brand.</p>`;
    return;
  }

  results.forEach(function(product) {
    // Cache by id so the deep-dive button can resolve this product later.
    _searchedProductCache[product.id] = product;

    const div = document.createElement('div');
    div.className = 'ingredient-result packaged-result';

    // The clickable header adds the product to the meal; the analysis block
    // below it is informational, so the click target is the header only.
    const header = document.createElement('div');
    header.className = 'packaged-result-header';
    header.style.cursor = 'pointer';
    header.innerHTML =
      '<strong>' + product.name + '</strong> ' +
      nutriScoreBadgeHtml(product.nutriscore) + ' ' +
      novaBadgeHtml(product.nova_group) + ' ' +
      '<span class="diet-badge packaged-badge">PACKAGED</span>';
    header.addEventListener('click', function() {
      registerExternalIngredient(product);
      promptGramAmount(product, div);
    });
    div.appendChild(header);

    // Ingredient-list analysis, rendered asynchronously into its own container.
    const analysisEl = document.createElement('div');
    analysisEl.className = 'ingredient-analysis-wrap';
    div.appendChild(analysisEl);
    showIngredientAnalysis(product, analysisEl);

    container.appendChild(div);
  });
}

// Renders the red/amber/green ingredient-list breakdown for a packaged product
// into containerEl. Used by both the Packaged search panel and the barcode
// scanner's scanned-product panel.
async function showIngredientAnalysis(product, containerEl) {
  const ingredientText = product._rawIngredients || '';
  if (!ingredientText) {
    containerEl.innerHTML = '<p class="no-ingredients">No ingredient list available.</p>';
    return;
  }

  const analysis = await analyseIngredientList(ingredientText);

  const renderFlags = (flags, cssClass, label) => {
    if (flags.length === 0) return '';
    return `
      <div class='flag-group ${cssClass}'>
        <span class='flag-group-label'>${label}</span>
        ${flags.map(f => `
          <div class='flag-item'>
            <span class='flag-name'>${f.short}</span>
            <span class='flag-explanation'>${f.explanation}</span>
          </div>
        `).join('')}
      </div>`;
  };

  const noFlags = analysis.red.length === 0 && analysis.amber.length === 0
               && analysis.green.length === 0;

  containerEl.innerHTML = `
    <div class='ingredient-analysis'>
      <div class='analysis-heading'>${t('packaged.analysis_heading')}</div>
      ${noFlags ? `<p class='no-flags'>${t('packaged.no_flags')}</p>` : ''}
      ${renderFlags(analysis.red,   'flag-red',   t('packaged.red_flags'))}
      ${renderFlags(analysis.amber, 'flag-amber', t('packaged.amber_flags'))}
      ${renderFlags(analysis.green, 'flag-green', t('packaged.green_flags'))}
      <p class='analysis-disclaimer'>${t('packaged.disclaimer')}</p>
      <button class='btn-ingredient-deep'
              id='deep-btn-${product.id}'
              onclick='generateIngredientDeepDive("${product.id}",
                       this.closest(".ingredient-analysis"))'>
        ${t('packaged.generate_deep')}
      </button>
      <div id='deep-analysis-${product.id}'></div>
    </div>`;
}

// On demand, call the RAG /ingredient-analysis endpoint for a deep, cited
// explanation of a packaged product's ingredient combination. Results are
// cached in sessionStorage per product + language so re-opening is instant.
async function generateIngredientDeepDive(productId, containerEl) {
  const product = _scannedProductCache[productId]
               || _searchedProductCache[productId];
  if (!product) return;

  const btn = document.getElementById(`deep-btn-${productId}`);
  const outputEl = document.getElementById(`deep-analysis-${productId}`);

  // Check sessionStorage cache
  const cacheKey = `deep_${productId}_${getCurrentLang()}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    renderDeepAnalysis(outputEl, JSON.parse(cached));
    btn.style.display = 'none';
    return;
  }

  btn.disabled = true;
  btn.textContent = t('packaged.generating') || 'Generating...';
  outputEl.innerHTML = '<div class="explanation-loading"><div class="explanation-spinner"></div> Analysing ingredients...</div>';

  // Get the current analysis flags
  const analysis = await analyseIngredientList(product._rawIngredients || '');

  try {
    const res = await fetch(RAG_SERVER_URL + '/ingredient-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_name: product.name,
        ingredients_text: product._rawIngredients || '',
        red_flags: analysis.red.map(f => f.short),
        amber_flags: analysis.amber.map(f => f.short),
        nutriscore: product.nutriscore || null,
        nova_group: product.nova_group || null,
        context: state.context,
        language: getCurrentLang(),
      }),
      signal: AbortSignal.timeout(45000)
    });

    if (!res.ok) throw new Error('Server error');
    const data = await res.json();

    sessionStorage.setItem(cacheKey, JSON.stringify(data));
    renderDeepAnalysis(outputEl, data);
    btn.style.display = 'none';
  } catch(err) {
    outputEl.innerHTML = `<p class='ai-overview-error'>
      Analysis unavailable${err.name === 'TimeoutError'
        ? ' (server warming up — try again)'
        : ''}.</p>`;
    btn.disabled = false;
    btn.textContent = t('packaged.generate_deep');
  }
}

function renderDeepAnalysis(containerEl, data) {
  const citations = (data.chunks_used || []).map(c =>
    `<li><em>${c.source}</em>: ${c.citation}</li>`
  ).join('');

  containerEl.innerHTML = `
    <div class='ai-overview' style='margin-top: var(--space-sm)'>
      <div class='ai-overview-header'>
        <span class='ai-overview-label'>${t('packaged.generate_deep')}</span>
        <span class='ai-overview-note'>${t('learn_more.ai_overview_note')}</span>
      </div>
      <div class='ai-overview-text'>${data.analysis}</div>
      <details class='ai-overview-sources'>
        <summary>${t('learn_more.sources_used')}</summary>
        <ul>${citations}</ul>
      </details>
    </div>`;
}

// Cooked/raw only applies to ingredients that carry a conversion factor
// (rice, flours, dals, potatoes, chicken, egg). Fats, dairy, vegetables and
// nuts have a null factor and no cooked/raw distinction, so the toggle is
// hidden and the entered grams are used directly.
function showsCookedToggle(ingredient) {
  if (ingredient.cooked_conversion_factor != null) return true;
  // Packaged (Open Food Facts) products have a null conversion factor and no
  // cooked/raw distinction, so a toggle would be cosmetic — always hide it.
  if (ingredient._isPackaged) return false;
  // USDA foods carry no conversion factor, but starch and legume items still
  // offer the cooked/raw toggle so the choice is available for them.
  if (ingredient._isExternal && Array.isArray(ingredient.role_tags) &&
      (ingredient.role_tags.includes('starch_source') ||
       ingredient.role_tags.includes('legume_protein'))) {
    return true;
  }
  return false;
}

// Servings-based amount entry for foods that report a serving size (Open
// Food Facts serving_quantity, or Branded USDA foods). The +/- multiplier
// just drives the same #gram-input the plain-100g path uses, so there is a
// single source of truth for the amount being added.
function servingMultiplierHtml(ingredient) {
  const servingG = ingredient.serving_size_g;
  if (!servingG) return '';
  const servingText = ingredient.serving_size_text;
  return '<div class="serving-row">' +
    '<span class="serving-label">1 serving = ' + servingG + 'g' +
      (servingText ? ' (' + servingText + ')' : '') + '</span>' +
    '<div class="serving-multiplier">' +
      '<button type="button" id="serving-minus">−</button>' +
      '<span id="serving-count">1</span> serving(s)' +
      '<button type="button" id="serving-plus">+</button>' +
      '<span class="serving-grams" id="serving-grams-display">= ' + servingG + 'g</span>' +
    '</div></div>';
}

function promptGramAmount(ingredient, clickedDiv) {
  const hasToggle = showsCookedToggle(ingredient);
  const toggleHtml = hasToggle
    ? '<span class="cooked-toggle"> ' +
        '<label><input type="radio" name="cooked-weight" value="raw"> Raw weight</label> ' +
        '<label><input type="radio" name="cooked-weight" value="cooked" checked> Cooked weight</label>' +
      '</span> '
    : '';
  const servingG = ingredient.serving_size_g;
  const initialGrams = ingredient.default_grams || 100;

  const form = document.createElement('div');
  form.innerHTML =
    '<span>' + ingredient.name + '</span> ' +
    '<input type="number" min="1" max="2000" value="' + initialGrams + '" id="gram-input"> ' +
    '<span>g</span> ' +
    toggleHtml +
    servingMultiplierHtml(ingredient) +
    '<button id="gram-add-btn">Add</button> ' +
    '<button id="gram-cancel-btn">Cancel</button>';

  clickedDiv.replaceWith(form);

  if (servingG) {
    const gramInput = form.querySelector('#gram-input');
    const countEl = form.querySelector('#serving-count');
    const gramsDisplayEl = form.querySelector('#serving-grams-display');
    let servings = 1;

    const applyServings = () => {
      const grams = Math.round(servings * servingG);
      gramInput.value = grams;
      countEl.textContent = servings % 1 === 0 ? servings : servings.toFixed(1);
      gramsDisplayEl.textContent = '= ' + grams + 'g';
    };

    form.querySelector('#serving-minus').addEventListener('click', function() {
      servings = Math.max(0.5, servings - 0.5);
      applyServings();
    });
    form.querySelector('#serving-plus').addEventListener('click', function() {
      servings += 0.5;
      applyServings();
    });
    // Typing a gram amount directly keeps the serving display in sync.
    gramInput.addEventListener('input', function() {
      const grams = parseFloat(gramInput.value) || 0;
      servings = grams / servingG;
      countEl.textContent = servings % 1 === 0 ? servings : servings.toFixed(1);
      gramsDisplayEl.textContent = '= ' + grams + 'g';
    });
  }

  form.querySelector('#gram-add-btn').addEventListener('click', function() {
    const gramAmount = parseInt(form.querySelector('#gram-input').value, 10);
    if (!gramAmount || gramAmount <= 0) return;
    let isCooked = false;
    if (hasToggle) {
      const selected = form.querySelector('input[name="cooked-weight"]:checked');
      isCooked = selected ? selected.value === 'cooked' : true;
    }
    addIngredientToMeal(ingredient.id, gramAmount, isCooked);
  });

  form.querySelector('#gram-cancel-btn').addEventListener('click', function() {
    // Packaged products live in their own panel; re-render from the cached
    // OFF search rather than the local ingredient list.
    if (ingredient._isPackaged) {
      const pkgQuery = document.getElementById('packaged-search').value.trim();
      searchOpenFoodFacts(pkgQuery).then(function(pkgResults) {
        renderPackagedResults(pkgResults, pkgQuery);
      });
      return;
    }
    const searchInput = document.getElementById('ingredient-search');
    const query = searchInput.value.trim();
    const nonvegToggle = document.getElementById('nonveg-toggle');
    const results = searchIngredients(query, !nonvegToggle.checked);
    renderIngredientResults(results, query);
  });
}

// Third argument is overloaded: a boolean isCooked from the local/USDA gram
// prompt, or a full ingredientRecord for externally-sourced products (scanned
// barcodes, and any other food not present in ingredients.json). When a record
// is supplied it is registered so getIngredientById / computeMealNutrients
// resolve it directly by id, exactly like a local ingredient.
function addIngredientToMeal(id, gramAmount, isCookedOrRecord) {
  let isCooked = false;
  if (isCookedOrRecord && typeof isCookedOrRecord === 'object') {
    registerExternalIngredient(isCookedOrRecord);
  } else if (isCookedOrRecord === true) {
    isCooked = true;
  }
  const item = { type: 'ingredient', id: id, gramAmount: gramAmount };
  if (isCooked === true) item.isCooked = true;
  state.mealItems.push(item);
  document.getElementById('ingredient-search').value = '';
  document.getElementById('ingredient-results').innerHTML = '';
  // A packaged product may have been added from the Packaged panel; clear it too.
  const packagedSearch = document.getElementById('packaged-search');
  const packagedResults = document.getElementById('packaged-results');
  if (packagedSearch) packagedSearch.value = '';
  if (packagedResults) packagedResults.innerHTML = '';
  renderMealItems();
  updateNutrientTotals();
  updateCalculateButton();
}

// Human-readable serving size for a dish search result. Prefers the recorded
// serving_size_g, falls back to an estimate from total_weight_g / servings.
function formatDishServingInfo(dish) {
  // serving_size_g is the weight of one serving
  if (dish.serving_size_g) {
    return `1 serving = ${dish.serving_size_g}g`;
  }
  // Fallback: estimate from total_weight_g / servings
  if (dish.total_weight_g && dish.servings) {
    const est = Math.round(dish.total_weight_g / dish.servings);
    return `1 serving ≈ ${est}g (estimated)`;
  }
  return '1 serving (size not recorded)';
}

function renderDishResults(results, query) {
  const container = document.getElementById('dish-results');
  container.innerHTML = '';

  if (query.length < 2) {
    container.innerHTML = '<p>Type at least 2 characters to search.</p>';
    return;
  }

  if (results.length === 0) {
    container.innerHTML = `<p>No dishes found matching '${query}'. Try a different spelling.</p>`;
    return;
  }

  results.forEach(function(dish) {
    const div = document.createElement('div');
    div.className = 'search-result dish-result';
    div.style.cursor = 'pointer';

    const badge = DIET_BADGE[dish.diet_type] || { label: dish.diet_type, color: 'gray' };

    div.innerHTML =
      '<span class="search-result-name">' + dish.name + '</span> ' +
      '<span class="diet-badge ' + dish.diet_type + '">' + badge.label + '</span> ' +
      '<span class="dish-serving-size">' + formatDishServingInfo(dish) + '</span>';

    div.addEventListener('click', function() {
      promptServingCount(dish, div);
    });

    container.appendChild(div);
  });
}

function promptServingCount(dish, clickedDiv) {
  const resultDiv = document.createElement('div');
  clickedDiv.replaceWith(resultDiv);

  const servingG = dish.serving_size_g ||
    (dish.total_weight_g && dish.servings
       ? Math.round(dish.total_weight_g / dish.servings) : null);

  // Build the prompt HTML with a live gram counter
  resultDiv.innerHTML = `
    <div class='serving-prompt'>
      <span class='serving-prompt-name'>${dish.name}</span>
      <div class='serving-prompt-controls'>
        <input type='number' id='serving-input'
               min='0.5' max='10' step='0.5' value='1' />
        <span>serving(s)</span>
        ${servingG ? `<span id='serving-gram-display'
          class='serving-gram-display'>= ${servingG}g</span>` : ''}
      </div>
      ${servingG ? `<p class='serving-size-note'>
        1 serving = ${servingG}g
        ${dish.serving_size_g ? '' : ' (estimated)'}
      </p>` : ''}
      <div class='serving-prompt-actions'>
        <button id='add-serving-btn'>Add to meal</button>
        <button id='cancel-serving-btn'>Cancel</button>
      </div>
    </div>`;

  // Update gram display as serving count changes
  if (servingG) {
    document.getElementById('serving-input').addEventListener('input', e => {
      const g = Math.round(parseFloat(e.target.value || 1) * servingG);
      const el = document.getElementById('serving-gram-display');
      if (el) el.textContent = `= ${g}g`;
    });
  }

  document.getElementById('add-serving-btn').addEventListener('click', () => {
    const servings = parseFloat(
      document.getElementById('serving-input').value);
    if (!servings || servings <= 0) return;
    addDishToMeal(dish.id, servings);
  });
  document.getElementById('cancel-serving-btn').addEventListener('click', () => {
    const results = searchDishes(_lastDishQuery, _includeNonVeg);
    renderDishResults(results, _lastDishQuery);
  });
}

function addDishToMeal(id, servings) {
  const dish = getDishById(id);
  if (dish) {
    dish.ingredients.forEach(function(entry) {
      if (!getIngredientById(entry.ingredient_id)) {
        console.warn('Dish ' + id + ' has unresolved ingredient:', entry.ingredient_id);
      }
    });
  }

  state.mealItems.push({ type: 'dish', id: id, servings: parseFloat(servings) });
  document.getElementById('dish-search').value = '';
  document.getElementById('dish-results').innerHTML = '';
  renderMealItems();
  updateNutrientTotals();
  updateCalculateButton();
}

function updateCalculateButton() {
  document.getElementById('calculate-btn').disabled = state.mealItems.length === 0;

  const cookingVoiceBtn = document.getElementById('cooking-voice-btn');
  if (cookingVoiceBtn) {
    const hasIngredient = state.mealItems.some(item => item.type === 'ingredient');
    cookingVoiceBtn.style.display = hasIngredient ? 'inline-block' : 'none';
  }
}

// Expanded meal-list card for a dish item: name, serving/gram total, a
// collapsible per-ingredient breakdown scaled to the chosen serving count.
function renderDishMealItem(item, index) {
  const dish = getDishById(item.id);
  if (!dish) return '<div>Unknown dish</div>';

  const servingG = dish.serving_size_g ||
    (dish.total_weight_g && dish.servings
      ? Math.round(dish.total_weight_g / dish.servings) : null);
  const totalG = servingG ? Math.round(servingG * item.servings) : null;

  const servingText = servingG
    ? `${item.servings} serving${item.servings !== 1 ? 's' : ''} (${totalG}g total)`
    : `${item.servings} serving${item.servings !== 1 ? 's' : ''}`;

  // Build ingredient list
  const ingredientRows = (dish.ingredients || []).map(di => {
    const ing = getIngredientById(di.ingredient_id);
    const scaledG = Math.round(di.amount_g * item.servings / (dish.servings || 1));
    return `
      <div class='dish-ingredient-row'>
        <span class='dish-ing-name'>${ing ? ing.name : di.ingredient_id}</span>
        <span class='dish-ing-amount'>${scaledG}g</span>
      </div>`;
  }).join('');

  const detailId = `dish-detail-${index}`;

  return `
    <div class='meal-item dish-meal-item'>
      <div class='meal-item-main'>
        <span class='meal-item-name'>${dish.name}</span>
        <span class='diet-badge dish-badge'>DISH</span>
        <span class='meal-item-qty'>${servingText}</span>
      </div>
      <div class='meal-item-actions'>
        <button onclick='toggleDishDetail("${detailId}")'>
          ▼ Ingredients
        </button>
        <button onclick='editMealItem(${index})'>Edit</button>
        <button onclick='removeFromMeal(${index})'>Remove</button>
      </div>
      <div id='${detailId}' class='dish-ingredient-list' style='display:none'>
        <div class='dish-ingredient-header'>
          <span>Ingredient</span>
          <span>Amount (${item.servings} serving${item.servings !== 1 ? 's' : ''})</span>
        </div>
        ${ingredientRows}
        ${servingG ? `<div class='dish-total-row'>
          <span>Total weight</span>
          <span>${totalG}g</span>
        </div>` : ''}
      </div>
    </div>`;
}

// Global: toggles a dish's ingredient breakdown open/closed and flips the
// button caret. Referenced from the inline onclick in renderDishMealItem.
function toggleDishDetail(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'block';
  // Update the button text
  const btn = el.previousElementSibling.querySelector('button:first-child');
  if (btn) btn.textContent = isOpen ? '▼ Ingredients' : '▲ Ingredients';
}

// Global: remove a meal item by index. Referenced from the inline onclick in
// renderDishMealItem.
function removeFromMeal(index) {
  state.mealItems.splice(index, 1);
  renderMealItems();
  updateNutrientTotals();
  updateCalculateButton();
}

// Global: inline-edit a dish item's serving count. Referenced from the inline
// onclick in renderDishMealItem.
function editMealItem(index) {
  const item = state.mealItems[index];
  if (!item || item.type !== 'dish') return;
  const node = document.getElementById('dish-meal-item-' + index);
  const main = node ? node.querySelector('.meal-item-main') : null;
  if (!main) return;

  const dish = getDishById(item.id);
  const name = dish ? dish.name : item.id;
  main.innerHTML =
    '<span class="meal-item-name">' + name + '</span> ' +
    '<input type="number" min="0.5" max="10" step="0.5" value="' + item.servings +
      '" id="edit-serving-input"> ' +
    '<span>serving(s)</span> ' +
    '<button id="edit-serving-save">Save</button> ' +
    '<button id="edit-serving-cancel">Cancel</button>';

  document.getElementById('edit-serving-save').addEventListener('click', function() {
    const v = parseFloat(document.getElementById('edit-serving-input').value);
    if (!v || v <= 0) return;
    state.mealItems[index].servings = v;
    renderMealItems();
    updateNutrientTotals();
  });
  document.getElementById('edit-serving-cancel').addEventListener('click', function() {
    renderMealItems();
  });
}

// ===== Step 66 — cooking method selectors =====
// Local ingredients carry role_tags + food_group, not the single `category`
// field the cooking-methods dataset keys on (starch_source / legume / vegetable
// / dairy / protein_source / fat_source / snack). Map an ingredient onto one of
// those categories; return null for ingredients where a cooking choice makes no
// sense (fats, nuts, spices, condiments, sweeteners) so no selector is shown.
function ingredientCookingCategory(ing) {
  const tags = ing.role_tags || [];
  if (tags.includes('starch_source') || tags.includes('starchy_vegetable')) return 'starch_source';
  if (tags.includes('legume_protein')) return 'legume';
  if (tags.includes('animal_protein')) return 'protein_source';
  if (tags.includes('dairy_protein')) return 'dairy';
  if (tags.includes('vegetable')) return 'vegetable';
  return null;
}

function renderCookingMethodSelector(item, index) {
  const ing = getIngredientById(item.id);
  if (!ing) return '';

  const category = ingredientCookingCategory(ing);
  if (!category) return '';

  const methods = getCookingMethodsForCategory(category);
  if (methods.length <= 1) return '';  // no choice to offer

  const lang = getCurrentLang();
  // Packaged (Open Food Facts) products — including scanned barcodes, which
  // are normalised through the same OFF path — carry no cooking instructions
  // of their own, so default them to "N/A" instead of "Boiled".
  const defaultMethod = ing._isPackaged
    ? 'none'
    : (methods.some(m => m.id === 'boiled') ? 'boiled' : methods[0].id);
  const current = item.cooking_method || defaultMethod;

  return `
    <select class='cooking-method-select'
            onchange='setCookingMethod(${index}, this.value)'>
      ${methods.map(m => `
        <option value='${m.id}'
          ${m.id === current ? 'selected' : ''}>
          ${m[`name_${lang}`] || m.name}
        </option>`,
      ).join('')}
    </select>`;
}

function setCookingMethod(index, methodId) {
  state.mealItems[index].cooking_method = methodId;
  renderMealItems();
  updateNutrientTotals();
  // Show the GI impact note
  const method = _cookingMethods.find(m => m.id === methodId);
  if (method && method.gi_multiplier !== 1.0) {
    const pct = Math.round((1 - method.gi_multiplier) * 100);
    const msg = pct > 0
      ? `↓ GI reduced by ~${pct}% (${method.note})`
      : `↑ GI increased by ~${Math.abs(pct)}%`;
    showCookingNote(msg);
  }
}

function showCookingNote(msg) {
  let note = document.getElementById('cooking-method-note');
  if (!note) {
    note = document.createElement('p');
    note.id = 'cooking-method-note';
    note.className = 'cooking-note';
    document.getElementById('meal-items').after(note);
  }
  note.textContent = msg;
  setTimeout(() => { note.textContent = ''; }, 4000);
}

function renderMealItems() {
  const container = document.getElementById('meal-items');
  container.innerHTML = '';

  if (state.mealItems.length === 0) {
    container.innerHTML = '<p>No items yet. Search above to add.</p>';
    return;
  }

  state.mealItems.forEach(function(item, index) {
    // Dish items render an expanded card with a collapsible ingredient
    // breakdown; the inline onclick handlers call the global helpers below.
    if (item.type === 'dish') {
      const temp = document.createElement('div');
      temp.innerHTML = renderDishMealItem(item, index).trim();
      const node = temp.firstElementChild;
      if (node) {
        node.id = 'dish-meal-item-' + index;
        container.appendChild(node);
      }
      return;
    }

    let name = '';
    let quantity = '';

    const ingItem = getIngredientById(item.id);
    name = ingItem ? ingItem.name : item.id;
    quantity = item.gramAmount;

    const div = document.createElement('div');
    div.className = 'meal-item';

    const label = document.createElement('span');
    // Nutri-Score / NOVA badges for packaged products, shown after the label.
    let badgesSpan = null;
    {
      const ing = getIngredientById(item.id);
      let weightNote = '';
      if (ing && ing.cooked_conversion_factor != null) {
        weightNote = item.isCooked === true ? ' (cooked)' : ' (raw)';
      }
      label.textContent = (index + 1) + '. ' + name + '  ' + quantity + ' g' + weightNote;

      if (ing && ing._isPackaged) {
        const badgesHtml = nutriScoreBadgeHtml(ing.nutriscore) + ' ' +
          novaBadgeHtml(ing.nova_group);
        if (badgesHtml.trim()) {
          badgesSpan = document.createElement('span');
          badgesSpan.className = 'meal-item-badges';
          badgesSpan.innerHTML = ' ' + badgesHtml;
        }
      }
    }

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function() {
      state.mealItems.splice(index, 1);
      renderMealItems();
      updateNutrientTotals();
      updateCalculateButton();
    });

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', function() {
      startEditMealItem(item, index, label, name);
    });

    div.appendChild(label);
    if (badgesSpan) div.appendChild(badgesSpan);
    div.appendChild(removeBtn);
    div.appendChild(editBtn);

    // Step 66 — cooking method selector, shown only when the ingredient's
    // category offers a real choice of methods.
    const selectorHtml = renderCookingMethodSelector(item, index);
    if (selectorHtml) {
      const wrap = document.createElement('span');
      wrap.innerHTML = selectorHtml.trim();
      const sel = wrap.firstElementChild;
      if (sel) div.appendChild(sel);
    }

    container.appendChild(div);
  });

  const clearBtn = document.createElement('button');
  clearBtn.id = 'clear-meal-btn';
  clearBtn.textContent = 'Clear meal';
  clearBtn.addEventListener('click', function() {
    state.mealItems = [];
    renderMealItems();
    updateNutrientTotals();
    updateCalculateButton();
  });
  container.appendChild(clearBtn);
}

function startEditMealItem(item, index, label, name) {
  const isDish = item.type === 'dish';
  const currentValue = isDish ? item.servings : item.gramAmount;

  const form = document.createElement('span');
  form.innerHTML =
    '<span>' + (index + 1) + '. ' + name + '</span> ' +
    '<input type="number" ' +
      (isDish ? 'min="0.5" max="10" step="0.5"' : 'min="1" max="2000"') +
      ' value="' + currentValue + '" id="edit-input"> ' +
    '<span>' + (isDish ? 'serving(s)' : 'g') + '</span> ' +
    '<button id="edit-save-btn">Save</button> ' +
    '<button id="edit-cancel-btn">Cancel</button> ' +
    '<span id="edit-error" style="color:red; font-size:0.85em;"></span>';

  label.replaceWith(form);

  const input = form.querySelector('#edit-input');

  function saveEdit() {
    const newValue = parseFloat(input.value);
    if (!newValue || newValue <= 0) {
      form.querySelector('#edit-error').textContent = 'Must be greater than 0';
      return;
    }
    if (isDish) {
      state.mealItems[index].servings = newValue;
    } else {
      state.mealItems[index].gramAmount = newValue;
    }
    renderMealItems();
    updateNutrientTotals();
  }

  form.querySelector('#edit-save-btn').addEventListener('click', saveEdit);

  input.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') saveEdit();
  });

  form.querySelector('#edit-cancel-btn').addEventListener('click', function() {
    renderMealItems();
  });
}

function updateNutrientTotals() {
  const totals = computeMealNutrients(state.mealItems);
  const container = document.getElementById('meal-nutrient-totals');
  const sodiumTotal = totals.sodium_mg + (state.addedSodiumMg || 0);

  const chips = [
    { value: totals.energy_kcal.toFixed(0),      label: 'kcal' },
    { value: totals.carbohydrate_g.toFixed(1),   label: 'carbs' },
    { value: totals.fiber_g.toFixed(1),          label: 'fiber' },
    { value: totals.total_fat_g.toFixed(1),      label: 'fat' },
    { value: totals.saturated_fat_g.toFixed(1),  label: 'sat fat' },
    { value: totals.protein_g.toFixed(1),        label: 'protein' },
    { value: sodiumTotal.toFixed(0),             label: 'sodium' }
  ];

  container.innerHTML = chips.map(function(chip) {
    return '<div class="nutrient-chip">' +
      '<span class="nutrient-chip-value">' + chip.value + '</span>' +
      '<span class="nutrient-chip-label">' + chip.label + '</span>' +
      '</div>';
  }).join('');
}

// ===== Step 78 — precise sodium entry =====
function getSodiumFromSelector() {
  const value = document.getElementById('salt-input').value;
  return value !== 'null' ? parseInt(value, 10) : null;
}

function updatePreciseSodium(value, unit) {
  if (!value) {
    state.addedSodiumMg = getSodiumFromSelector();
    updateNutrientTotals();
    return;
  }
  const num = parseFloat(value);
  let mgValue;
  if (unit === 'mg')  mgValue = num;
  if (unit === 'tsp') mgValue = num * 2300;
  if (unit === 'g')   mgValue = num * 1000 * 0.393;
  // 0.393 = fraction of salt that is sodium
  state.addedSodiumMg = Math.round(mgValue);
  updateNutrientTotals();
}

function updateSodiumUnit() {
  const value = document.getElementById('sodium-exact').value;
  const unit  = document.getElementById('sodium-unit').value;
  if (value) updatePreciseSodium(value, unit);
}

// ===== Step 64 — barcode contribution pipeline =====
// After a scan resolves an Open Food Facts product, check whether it already
// lives in our Supabase `ingredients` table. If approved, use the stored
// record; if pending, fall back to the live OFF data; otherwise offer the user
// the chance to contribute it for review.
//
// NOTE ON DATA SHAPES: the scan pipeline (lookupOFFByBarcode / the scan cache)
// hands us an ALREADY-normalised product — the shape normaliseOFFProduct
// returns: { id, name, nutrients_per_100g:{…}, role_tags, _rawIngredients,
// nutriscore, … }. It does NOT carry the raw OFF fields (product_name, brands,
// categories_tags, ingredients_text). The helpers below read the normalised
// fields, and _asNormalisedOFF() also accepts a raw OFF product for safety.
function _asNormalisedOFF(offProduct) {
  if (offProduct && offProduct.nutrients_per_100g) return offProduct; // already normalised
  return normaliseOFFProduct(offProduct);                            // raw OFF → normalise
}

async function handleScannedBarcode(barcode, offProduct) {
  const product = _asNormalisedOFF(offProduct);
  window._lastScanned = product;

  // Check if this barcode already exists in our ingredient database. RLS only
  // exposes approved rows to the public, so a pending row generally reads back
  // as "not found" for non-owners, and we fall through to the contribute prompt.
  // maybeSingle() returns null (not a 406) on zero rows — the common "not in
  // database" case — so the normal path stays quiet in the console.
  const { data: existing } = await _supabase
    .from('ingredients')
    .select('id, name, status')
    .eq('id', `off_${barcode}`)
    .maybeSingle();

  if (existing && existing.status === 'approved') {
    // Already in database — use it directly. Pass the scanned product as the
    // record too so it resolves even if it was approved after page load.
    addIngredientToMeal(existing.id, 100, product);
    showScanSuccess(`${existing.name} (from database)`);
    return;
  }

  if (existing && existing.status === 'pending') {
    // Pending review — use Open Food Facts data for now.
    showScanStatus('Product is pending database review — using Open Food Facts data.');
    addPackagedProductToMeal(product);
    return;
  }

  // Not in database — offer to contribute.
  showContributePrompt(barcode, product);
}

function showContributePrompt(barcode, offProduct) {
  const productName = offProduct.name || offProduct.product_name || 'Unknown product';
  const nutrients   = offProduct.nutrients_per_100g || {};

  // Preserve the full scan UX: the card keeps the grams input and the
  // red/amber/green ingredient-list analysis (with its deep-dive button) that
  // the direct scanned-product view had, adding the contribute action on top.
  // Cache by id so the deep-dive analysis can resolve this product later.
  _scannedProductCache[offProduct.id] = offProduct;
  window._lastScanned = offProduct;

  document.getElementById('scan-result').innerHTML = `
    <div class='scan-product-card'>
      <div class='scan-product-name'>${productName}</div>
      <div class='scan-product-nutrients'>
        Per 100g: ${nutrients.energy_kcal?.toFixed(0) || '?'} kcal |
        Carbs ${nutrients.carbohydrate_g?.toFixed(1) || '?'}g |
        Fat ${nutrients.total_fat_g?.toFixed(1) || '?'}g |
        Protein ${nutrients.protein_g?.toFixed(1) || '?'}g
      </div>
      <label class='scan-grams-label'>Amount:
        <input type='number' id='scan-grams' value='100' min='1' max='2000'> g
      </label>
      <div class='contribute-prompt'>
        <p>This product is not yet in our database.</p>
        <button onclick='contributeIngredient("${barcode}", this)'
                class='btn-contribute'>
          Add to database for review
        </button>
        <button onclick='useScannedOFFDataAnyway()'
                class='btn-use-anyway'>
          Use Open Food Facts data (not saved)
        </button>
      </div>
      <div id='scan-ingredient-analysis' class='ingredient-analysis-wrap'></div>
    </div>`;

  // Render the red/amber/green ingredient-list analysis for the scanned product.
  const analysisEl = document.getElementById('scan-ingredient-analysis');
  if (analysisEl) showIngredientAnalysis(offProduct, analysisEl);
}

// Read the grams from the scan card's Amount input, defaulting to 100 g.
function _scanGrams() {
  const el = document.getElementById('scan-grams');
  const g  = el ? parseInt(el.value, 10) : 100;
  return (!g || g < 1) ? 100 : g;
}

// "Use Open Food Facts data (not saved)" button: add the scanned product to the
// meal at the chosen grams without contributing it to the database.
function useScannedOFFDataAnyway() {
  const p = window._lastScanned;
  if (!p) return;
  addPackagedProductToMeal(p, _scanGrams());
  showScanSuccess(p.name || 'product');
}

async function contributeIngredient(barcode, btn) {
  if (!isSignedIn()) {
    alert('Sign in to contribute ingredients to the database.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  const offProduct = window._lastScanned;
  const nutrients  = offProduct.nutrients_per_100g || {};

  // The `ingredients` table is a JSON-native envelope: { id, name, data (jsonb),
  // status }. `data` must hold the full ingredient-shaped object so that, once
  // approved, loadIngredientsFromSupabase (which unwraps row.data) resolves and
  // scores it exactly like a local ingredient. We therefore store the normalised
  // product plus contribution metadata inside `data`.
  const productData = {
    ...offProduct,
    id:               `off_${barcode}`,
    name:             offProduct.name || `Product ${barcode}`,
    food_group:       offProduct.food_group || 'Packaged product',
    category:         inferCategoryFromOFF(offProduct),
    diet_type:        inferDietTypeFromOFF(offProduct),
    glycemic_index:   null,   // cannot determine from a packaged product
    // Packaged products carry no cooked/raw distinction — a null factor keeps
    // showsCookedToggle() from offering a (meaningless) cooked-weight toggle.
    cooked_conversion_factor: null,
    source:               'open_food_facts',
    contributor_user_id:  getUser().id,
    region:               null,
    _nutrientSnapshot:    nutrients,
  };

  const { error } = await _supabase
    .from('ingredients')
    .insert({
      id:     productData.id,
      name:   productData.name,
      data:   productData,
      status: 'pending',
    });

  if (error) {
    btn.disabled = false;
    btn.textContent = 'Retry';
    console.error('Contribution error:', error);
    alert('Could not submit: ' + error.message);
  } else {
    // Capture the chosen grams before the card is replaced by the status text.
    const grams = _scanGrams();
    btn.textContent = '✓ Submitted for review';
    // Add to meal using Open Food Facts data in the meantime.
    addPackagedProductToMeal(offProduct, grams);
    showScanStatus('Thank you! This product will be reviewed and added to the database.');
  }
}

function inferCategoryFromOFF(offProduct) {
  const cats = offProduct.categories_tags || [];
  if (cats.some(c => c.includes('cereal') || c.includes('grain'))) return 'starch_source';
  if (cats.some(c => c.includes('dairy')  || c.includes('milk')))  return 'dairy';
  if (cats.some(c => c.includes('legume') || c.includes('pulse'))) return 'legume';
  if (cats.some(c => c.includes('oil')    || c.includes('fat')))   return 'fat_source';
  if (cats.some(c => c.includes('vegetable')))                     return 'vegetable';
  if (cats.some(c => c.includes('meat')   || c.includes('fish')))  return 'protein_source';
  if (cats.some(c => c.includes('snack')  || c.includes('biscuit'))) return 'snack';
  // Normalised OFF products drop categories_tags; fall back to the role_tags
  // inferred from the product name (see inferRoleTags in data.js).
  const roles = offProduct.role_tags || [];
  if (roles.includes('starch_source'))  return 'starch_source';
  if (roles.includes('legume_protein')) return 'legume';
  if (roles.includes('fat_source'))     return 'fat_source';
  return 'other';
}

function inferDietTypeFromOFF(offProduct) {
  // Normalised products expose the raw ingredient string as _rawIngredients.
  const ingredients = (offProduct._rawIngredients ||
                       offProduct.ingredients_text || '').toLowerCase();
  if (/beef|pork|lamb|mutton|chicken|fish|prawn|shrimp|seafood|meat/.test(ingredients))
    return 'non_veg';
  if (/egg|mayonnaise/.test(ingredients)) return 'egg';
  return 'veg';
}

// Add an Open Food Facts product to the current meal at the given grams
// (default 100 g), registering it so getIngredientById / computeMealNutrients
// resolve it like any ingredient. Deliberately writes no scan-panel message so
// callers keep control of the status text they've already shown.
function addPackagedProductToMeal(offProduct, grams) {
  const product = _asNormalisedOFF(offProduct);
  if (!product || !product.id) return;
  addIngredientToMeal(product.id, grams || 100, product);
}

// Replace the scan panel with a plain status message.
function showScanStatus(msg) {
  const el = document.getElementById('scan-result');
  if (el) el.innerHTML = `<p class='scan-status'>${msg}</p>`;
}

// Replace the scan panel with a success confirmation.
function showScanSuccess(msg) {
  const el = document.getElementById('scan-result');
  if (el) el.innerHTML = `<p class='scan-status'>✓ Added ${msg} to meal.</p>`;
}

function initMealBuilder() {
  const searchInput = document.getElementById('ingredient-search');
  const dishSearchInput = document.getElementById('dish-search');
  const nonvegToggle = document.getElementById('nonveg-toggle');

  searchInput.addEventListener('input', function() {
    const query = searchInput.value.trim();
    // 1-2. Local search renders immediately (fast, no network).
    const results = searchIngredients(query, !nonvegToggle.checked);
    renderIngredientResults(results, query);
    // 3-5. Sparse local results fall back to USDA, appended asynchronously.
    if (results.length < 3) {
      searchUSDA(query).then(function(usdaResults) {
        appendUSDAResults(usdaResults, query);
      });
    }
  });

  dishSearchInput.addEventListener('input', function() {
    const query = dishSearchInput.value.trim();
    _lastDishQuery = query;
    _includeNonVeg = !nonvegToggle.checked;
    const results = searchDishes(query, _includeNonVeg);
    renderDishResults(results, query);
  });

  // Packaged (Open Food Facts) search is a network call, so debounce input by
  // 500ms to avoid firing a request on every keystroke.
  const packagedSearchInput = document.getElementById('packaged-search');
  let packagedDebounce = null;
  packagedSearchInput.addEventListener('input', function() {
    const query = packagedSearchInput.value.trim();
    clearTimeout(packagedDebounce);
    if (query.length < 2) {
      renderPackagedResults([], query);
      return;
    }
    packagedDebounce = setTimeout(function() {
      searchOpenFoodFacts(query).then(function(results) {
        // Guard against stale async: only render if the box still shows this query.
        if (packagedSearchInput.value.trim() !== query) return;
        renderPackagedResults(results, query);
      });
    }, 500);
  });

  nonvegToggle.addEventListener('change', function() {
    const query = searchInput.value.trim();
    const results = searchIngredients(query, !nonvegToggle.checked);
    renderIngredientResults(results, query);

    const dishQuery = dishSearchInput.value.trim();
    _lastDishQuery = dishQuery;
    _includeNonVeg = !nonvegToggle.checked;
    const dishResults = searchDishes(dishQuery, _includeNonVeg);
    renderDishResults(dishResults, dishQuery);
  });

  renderMealItems();
  updateNutrientTotals();
  updateCalculateButton();
}
