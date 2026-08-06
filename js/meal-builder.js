const DIET_BADGE = {
  veg:     { label: 'veg',     color: 'green'  },
  egg:     { label: 'egg',     color: '#b8860b' },
  non_veg: { label: 'non-veg', color: 'red'    }
};

// Last dish search query and non-veg inclusion flag, remembered so the serving
// prompt's Cancel button can restore the dish results it replaced.
let _lastDishQuery = '';
let _includeNonVeg = false;

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

function promptGramAmount(ingredient, clickedDiv) {
  const hasToggle = showsCookedToggle(ingredient);
  const toggleHtml = hasToggle
    ? '<span class="cooked-toggle"> ' +
        '<label><input type="radio" name="cooked-weight" value="raw"> Raw weight</label> ' +
        '<label><input type="radio" name="cooked-weight" value="cooked" checked> Cooked weight</label>' +
      '</span> '
    : '';

  const form = document.createElement('div');
  form.innerHTML =
    '<span>' + ingredient.name + '</span> ' +
    '<input type="number" min="1" max="2000" value="100" id="gram-input"> ' +
    '<span>g</span> ' +
    toggleHtml +
    '<button id="gram-add-btn">Add</button> ' +
    '<button id="gram-cancel-btn">Cancel</button>';

  clickedDiv.replaceWith(form);

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

  const chips = [
    { value: totals.energy_kcal.toFixed(0),      label: 'kcal' },
    { value: totals.carbohydrate_g.toFixed(1),   label: 'carbs' },
    { value: totals.fiber_g.toFixed(1),          label: 'fiber' },
    { value: totals.total_fat_g.toFixed(1),      label: 'fat' },
    { value: totals.saturated_fat_g.toFixed(1),  label: 'sat fat' },
    { value: totals.protein_g.toFixed(1),        label: 'protein' },
    { value: totals.sodium_mg.toFixed(0),        label: 'sodium' }
  ];

  container.innerHTML = chips.map(function(chip) {
    return '<div class="nutrient-chip">' +
      '<span class="nutrient-chip-value">' + chip.value + '</span>' +
      '<span class="nutrient-chip-label">' + chip.label + '</span>' +
      '</div>';
  }).join('');
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
