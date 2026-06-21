const FOOD_GROUP_GI = {
  'Cereals and millets': 72,
  'Pulses and legumes': 30,
  'Vegetables': 20,
  'Starchy vegetables': 65,
  'Fruits': 50,
  'Dairy': 30,
  'Fats and oils': 0,
  'Nuts and seeds': 20,
  'Sugars and sweets': 65,
  'Meat, poultry, fish, eggs': 0
};

let _ingredients = [];
let _dishes = [];
let _ingById = {};
let _dishById = {};
let _giOverrides = {};
let _recOverrides = [];
let _dataLoaded = false;

async function loadData() {
  const [ingredients, dishes, giOverrides, recOverrides] = await Promise.all([
    fetch('data/ingredients.json').then(r => r.json()),
    fetch('data/dishes.json').then(r => r.json()),
    fetch('data/gi-overrides.json').then(r => r.json()),
    fetch('data/rec-overrides.json').then(r => r.json())
  ]);

  _ingredients = ingredients;
  _dishes = dishes;
  _ingById = Object.fromEntries(ingredients.map(i => [i.id, i]));
  _dishById = Object.fromEntries(dishes.map(d => [d.id, d]));
  _giOverrides = Object.fromEntries(giOverrides.map(o => [o.ingredient_id, o.gi]));
  _recOverrides = recOverrides;
  _dataLoaded = true;
}

function searchIngredients(query, includeNonVeg) {
  if (query.length < 2) return [];
  const q = query.toLowerCase();
  return _ingredients
    .filter(i => {
      if (!i.name.toLowerCase().includes(q)) return false;
      if (!includeNonVeg && i.diet_type === 'non_veg') return false;
      return true;
    })
    .slice(0, 10);
}

function searchDishes(query, includeNonVeg) {
  if (query.length < 2) return [];
  const q = query.toLowerCase();
  return _dishes
    .filter(d => {
      if (!d.name.toLowerCase().includes(q)) return false;
      if (!includeNonVeg && d.diet_type === 'non_veg') return false;
      return true;
    })
    .slice(0, 10);
}

function getIngredientById(id) {
  return _ingById[id] || null;
}

function getDishById(id) {
  return _dishById[id] || null;
}

function getGI(ingredientId) {
  if (_giOverrides[ingredientId] !== undefined) return _giOverrides[ingredientId];
  const ing = _ingById[ingredientId];
  if (!ing) return null;
  if (ing.glycemic_index !== null && ing.glycemic_index !== undefined) return ing.glycemic_index;
  const gi = FOOD_GROUP_GI[ing.food_group];
  return gi !== undefined ? gi : null;
}

function getRecOverrides() {
  return _recOverrides;
}

function getAllIngredients() {
  return _ingredients;
}

function computeMealNutrients(mealItems) {
  const totals = {
    energy_kcal: 0,
    protein_g: 0,
    carbohydrate_g: 0,
    fiber_g: 0,
    total_fat_g: 0,
    saturated_fat_g: 0,
    sugars_g: 0,
    sodium_mg: 0
  };

  for (const item of mealItems) {
    let nutrients = null;
    let scale = 0;

    if (item.type === 'ingredient') {
      const ing = _ingById[item.id];
      if (!ing) continue;
      nutrients = ing.nutrients_per_100g;
      scale = (item.gramAmount || 0) / 100;
    } else if (item.type === 'dish') {
      const dish = _dishById[item.id];
      if (!dish) continue;
      nutrients = dish.nutrients_per_serving;
      scale = item.servings || 0;
    }

    if (!nutrients) continue;
    for (const key of Object.keys(totals)) {
      totals[key] += (nutrients[key] || 0) * scale;
    }
  }

  return totals;
}
