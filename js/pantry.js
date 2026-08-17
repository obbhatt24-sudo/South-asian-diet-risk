// Virtual pantry — lets a signed-in user track opened packaged products and
// how many servings remain, and pull them straight into a meal.

async function loadPantry() {
  if (!isSignedIn()) {
    document.getElementById('pantry-content').innerHTML =
      '<p>Sign in to use your pantry.</p>';
    return;
  }
  const { data: items } = await getPantryItems();
  renderPantryItems(items || []);
}

function renderPantryItems(items) {
  const list = document.getElementById('pantry-list');
  if (!items.length) {
    list.innerHTML = "<p class='empty-state'>Your pantry is empty. Scan products to add them.</p>";
    return;
  }
  list.innerHTML = items.map(item => {
    const remaining = item.servings_total - item.servings_used;
    const pct = Math.max(0, Math.min(100, remaining / item.servings_total * 100));
    return `
      <div class='pantry-item card'>
        <div class='pantry-item-header'>
          <div class='pantry-item-name'>
            ${item.product_name}
            <span class='pantry-item-brand'>${item.brand || ''}</span>
          </div>
          <div class='pantry-item-remaining'>
            ${remaining.toFixed(1)} / ${item.servings_total} servings left
          </div>
        </div>
        <div class='pantry-progress-bar'>
          <div class='pantry-progress-fill' style='width:${pct}%'></div>
        </div>
        <div class='pantry-item-actions'>
          <button onclick='usePantryItem("${item.id}", 1)'>
            + Use 1 serving
          </button>
          <button onclick='addPantryItemToMeal("${item.id}")'>
            Add to meal
          </button>
          <button onclick='deletePantryItem("${item.id}").then(loadPantry)'
                  style='color:var(--color-high)'>
            Remove
          </button>
        </div>
      </div>`;
  }).join('');
}

async function usePantryItem(itemId, servings) {
  const items = (await getPantryItems()).data || [];
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  const newUsed = Math.min(item.servings_total, item.servings_used + servings);
  await updatePantryServings(itemId, newUsed);
  loadPantry();
}

// Adds a pantry item to the meal builder as an ingredient, using the same
// normalised-product shape as a packaged (Open Food Facts) product.
async function addPantryItemToMeal(itemId) {
  const items = (await getPantryItems()).data || [];
  const item = items.find(i => i.id === itemId);
  if (!item || !item.nutrients_per_100g) return;

  const record = {
    id: 'pantry_' + item.id,
    name: item.product_name,
    food_group: 'Packaged product',
    diet_type: 'veg',
    role_tags: inferRoleTags(item.product_name || '', ''),
    nutrients_per_100g: item.nutrients_per_100g,
    glycemic_index: null,
    cooked_conversion_factor: null,
    serving_size_g: item.serving_size_g || 100,
    _isExternal: true,
    _isPackaged: true
  };

  addIngredientToMeal(record.id, record.serving_size_g, record);
  showView('meal-builder');
}
