const DIET_BADGE = {
  veg:     { label: 'veg',     color: 'green'  },
  egg:     { label: 'egg',     color: '#b8860b' },
  non_veg: { label: 'non-veg', color: 'red'    }
};

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
    div.className = 'ingredient-result';
    div.style.cursor = 'pointer';

    div.innerHTML =
      '<strong>' + product.name + '</strong> ' +
      nutriScoreBadgeHtml(product.nutriscore) + ' ' +
      novaBadgeHtml(product.nova_group) + ' ' +
      '<span class="diet-badge packaged-badge">PACKAGED</span>';

    div.addEventListener('click', function() {
      registerExternalIngredient(product);
      promptGramAmount(product, div);
    });

    container.appendChild(div);
  });
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
    div.className = 'dish-result';
    div.style.cursor = 'pointer';

    const badge = DIET_BADGE[dish.diet_type] || { label: dish.diet_type, color: 'gray' };

    div.innerHTML =
      '<strong>' + dish.name + '</strong> ' +
      '<span style="color:' + badge.color + '; font-size:0.85em;">' + badge.label + '</span>';

    div.addEventListener('click', function() {
      promptServingCount(dish, div);
    });

    container.appendChild(div);
  });
}

function promptServingCount(dish, clickedDiv) {
  const form = document.createElement('div');
  form.innerHTML =
    '<span>' + dish.name + '</span> ' +
    '<input type="number" min="0.5" max="10" step="0.5" value="1" id="serving-input"> ' +
    '<span>servings</span> ' +
    '<button id="serving-add-btn">Add</button> ' +
    '<button id="serving-cancel-btn">Cancel</button>';

  clickedDiv.replaceWith(form);

  form.querySelector('#serving-add-btn').addEventListener('click', function() {
    const servings = parseFloat(form.querySelector('#serving-input').value);
    if (!servings || servings <= 0) return;
    addDishToMeal(dish.id, servings);
  });

  form.querySelector('#serving-cancel-btn').addEventListener('click', function() {
    const searchInput = document.getElementById('dish-search');
    const query = searchInput.value.trim();
    const nonvegToggle = document.getElementById('nonveg-toggle');
    const results = searchDishes(query, !nonvegToggle.checked);
    renderDishResults(results, query);
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

function renderMealItems() {
  const container = document.getElementById('meal-items');
  container.innerHTML = '';

  if (state.mealItems.length === 0) {
    container.innerHTML = '<p>No items yet. Search above to add.</p>';
    return;
  }

  state.mealItems.forEach(function(item, index) {
    let name = '';
    let quantity = '';

    if (item.type === 'ingredient') {
      const ing = getIngredientById(item.id);
      name = ing ? ing.name : item.id;
      quantity = item.gramAmount;
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      name = dish ? dish.name : item.id;
      quantity = item.servings;
    }

    const div = document.createElement('div');
    div.className = 'meal-item';

    const label = document.createElement('span');
    // Nutri-Score / NOVA badges for packaged products, shown after the label.
    let badgesSpan = null;
    if (item.type === 'dish') {
      label.textContent = (index + 1) + '. ' + name + '  ' + quantity + ' serving(s)  [DISH]';
    } else {
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
  container.innerHTML =
    'Energy: ' + totals.energy_kcal.toFixed(1) + ' kcal | ' +
    'Carbs: ' + totals.carbohydrate_g.toFixed(1) + ' g | ' +
    'Fiber: ' + totals.fiber_g.toFixed(1) + ' g | ' +
    'Fat: ' + totals.total_fat_g.toFixed(1) + ' g | ' +
    'Sat Fat: ' + totals.saturated_fat_g.toFixed(1) + ' g | ' +
    'Protein: ' + totals.protein_g.toFixed(1) + ' g | ' +
    'Sodium: ' + totals.sodium_mg.toFixed(1) + ' mg';
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
    const results = searchDishes(query, !nonvegToggle.checked);
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
    const dishResults = searchDishes(dishQuery, !nonvegToggle.checked);
    renderDishResults(dishResults, dishQuery);
  });

  renderMealItems();
  updateNutrientTotals();
  updateCalculateButton();
}
