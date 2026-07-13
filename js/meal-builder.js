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

function promptGramAmount(ingredient, clickedDiv) {
  const form = document.createElement('div');
  form.innerHTML =
    '<span>' + ingredient.name + '</span> ' +
    '<input type="number" min="1" max="2000" value="100" id="gram-input"> ' +
    '<span>g</span> ' +
    '<button id="gram-add-btn">Add</button> ' +
    '<button id="gram-cancel-btn">Cancel</button>';

  clickedDiv.replaceWith(form);

  form.querySelector('#gram-add-btn').addEventListener('click', function() {
    const gramAmount = parseInt(form.querySelector('#gram-input').value, 10);
    if (!gramAmount || gramAmount <= 0) return;
    addIngredientToMeal(ingredient.id, gramAmount);
  });

  form.querySelector('#gram-cancel-btn').addEventListener('click', function() {
    const searchInput = document.getElementById('ingredient-search');
    const query = searchInput.value.trim();
    const nonvegToggle = document.getElementById('nonveg-toggle');
    const results = searchIngredients(query, !nonvegToggle.checked);
    renderIngredientResults(results, query);
  });
}

function addIngredientToMeal(id, gramAmount) {
  state.mealItems.push({ type: 'ingredient', id: id, gramAmount: gramAmount });
  document.getElementById('ingredient-search').value = '';
  document.getElementById('ingredient-results').innerHTML = '';
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
    if (item.type === 'dish') {
      label.textContent = (index + 1) + '. ' + name + '  ' + quantity + ' serving(s)  [DISH]';
    } else {
      label.textContent = (index + 1) + '. ' + name + '  ' + quantity + ' g';
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
    const results = searchIngredients(query, !nonvegToggle.checked);
    renderIngredientResults(results, query);
  });

  dishSearchInput.addEventListener('input', function() {
    const query = dishSearchInput.value.trim();
    const results = searchDishes(query, !nonvegToggle.checked);
    renderDishResults(results, query);
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
