const FOOD_GROUP_GI = {
  'Cereals and millets': 72,
  'Cereals and millets (refined)': 72,
  'Cereals and millets (whole grain)': 53,
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
let _ingredientFlags = null;
let _dataLoaded = false;

async function loadData() {
  const [ingredients, dishes, giOverrides, recOverrides, ingredientFlags] =
    await Promise.all([
      fetch('data/ingredients.json').then(r => r.json()),
      fetch('data/dishes.json').then(r => r.json()),
      fetch('data/gi-overrides.json').then(r => r.json()),
      fetch('data/rec-overrides.json').then(r => r.json()),
      fetch('data/ingredient-flags.json').then(r => r.json())
    ]);

  _ingredients = ingredients;
  _dishes = dishes;
  _ingById = Object.fromEntries(ingredients.map(i => [i.id, i]));
  _dishById = Object.fromEntries(dishes.map(d => [d.id, d]));
  _giOverrides = Object.fromEntries(giOverrides.map(o => [o.ingredient_id, o.gi]));
  _recOverrides = recOverrides;
  _ingredientFlags = ingredientFlags;
  _dataLoaded = true;
}

// ===== Packaged-product ingredient-list analysis =====
// Maps regex patterns over a raw Open Food Facts ingredient string to a set of
// red/amber/green risk flags (data/ingredient-flags.json). Explanations are
// localised via the explanation_<lang> keys, falling back to English.
async function loadIngredientFlags() {
  if (_ingredientFlags) return _ingredientFlags;
  const res = await fetch('data/ingredient-flags.json');
  _ingredientFlags = await res.json();
  return _ingredientFlags;
}

async function analyseIngredientList(ingredientListString) {
  // ingredientListString: raw ingredient text from Open Food Facts
  // e.g. 'Refined wheat flour, sugar, palm oil, salt, raising agents...'
  const flags = await loadIngredientFlags();
  const text  = ingredientListString.toLowerCase();
  const lang  = getCurrentLang();

  const results = { red: [], amber: [], green: [] };
  const seen = new Set();

  for (const flag of flags) {
    const regex = new RegExp(flag.pattern, 'i');
    if (regex.test(text) && !seen.has(flag.short)) {
      seen.add(flag.short);
      const explanation = flag[`explanation_${lang}`] || flag.explanation;
      results[flag.risk].push({
        short: flag.short,
        explanation,
        flagType: flag.flag
      });
    }
  }
  return results;
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

// ===== USDA FoodData Central fallback =====
// External foods fetched from USDA are cached into _ingById on add so that
// getIngredientById / computeMealNutrients resolve them exactly like local
// ingredients (their schema is identical).
function registerExternalIngredient(food) {
  if (food && food.id && !_ingById[food.id]) {
    _ingById[food.id] = food;
  }
}

async function searchUSDA(query) {
  if (!query || query.length < 2) return [];
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search` +
    `?query=${encodeURIComponent(query)}` +
    `&dataType=Foundation,SR%20Legacy` +
    `&pageSize=8` +
    `&api_key=${USDA_API_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return (data.foods || []).map(f => normaliseUSDAFood(f));
  } catch(e) {
    console.warn('USDA search failed:', e.message);
    return [];
  }
}

// Translate a USDA foodCategory string into one of the app's food_group keys
// so getGI()'s FOOD_GROUP_GI lookup resolves a glycemic index for USDA foods
// (their raw categories like "Cereal Grains and Pasta" don't match the table).
// Falls back to role_tags when the category text doesn't match, then to a safe
// low-GI default so a mis-categorised food never inflates the score.
function mapUSDACategory(usdaCategory, roleTags) {
  const c = (usdaCategory || '').toLowerCase();
  if (/cereal|grain|rice|pasta|bread|flour|oat/.test(c))
    return roleTags.includes('whole_grain')
      ? 'Cereals and millets (whole grain)'
      : 'Cereals and millets (refined)';
  if (/legume|bean|lentil|pea/.test(c))   return 'Pulses and legumes';
  if (/vegetable/.test(c))                return 'Vegetables';
  if (/fruit/.test(c))                    return 'Fruits';
  if (/dairy|milk|cheese|yogurt/.test(c)) return 'Dairy';
  if (/fat|oil|butter/.test(c))           return 'Fats and oils';
  if (/nut|seed/.test(c))                 return 'Nuts and seeds';
  if (/sugar|sweet|candy/.test(c))        return 'Sugars and sweets';
  if (/beef|pork|poultry|fish|seafood|egg|meat/.test(c))
    return 'Meat, poultry, fish, eggs';
  if (/potato|starch/.test(c))            return 'Starchy vegetables';
  // Fallback: infer from role_tags
  if (roleTags.includes('legume_protein'))  return 'Pulses and legumes';
  if (roleTags.includes('starch_source'))   return 'Cereals and millets (refined)';
  if (roleTags.includes('vegetable'))       return 'Vegetables';
  if (roleTags.includes('cooking_fat'))     return 'Fats and oils';
  if (roleTags.includes('dairy_protein'))   return 'Dairy';
  if (roleTags.includes('animal_protein'))  return 'Meat, poultry, fish, eggs';
  if (roleTags.includes('nut_seed'))        return 'Nuts and seeds';
  if (roleTags.includes('sweetener'))       return 'Sugars and sweets';
  return 'Vegetables';  // safe default (GI 20, won't inflate scores)
}

function normaliseUSDAFood(f) {
  // Map USDA nutrient IDs to our schema. A nutrient the USDA record does not
  // report returns null (not 0) so genuinely-missing data can be flagged as
  // incomplete rather than silently read as zero (which understates scores).
  const get = (id) => {
    const n = (f.foodNutrients || []).find(n => n.nutrientId === id);
    return n ? Math.round(n.value * 10) / 10 : null;
  };
  const inferredRoleTags = inferRoleTags(f.description, f.foodCategory);
  return {
    id: 'usda_' + f.fdcId,
    source_code: String(f.fdcId),
    name: f.description,
    food_group: mapUSDACategory(f.foodCategory, inferredRoleTags),
    diet_type: inferDietType(f.description),
    role_tags: inferredRoleTags,
    nutrients_per_100g: {
      energy_kcal: get(1008),
      protein_g:   get(1003),
      carbohydrate_g: get(1005),
      fiber_g:     get(1079),
      total_fat_g: get(1004),
      saturated_fat_g: get(1258),
      sugars_g:    get(2000),
      sodium_mg:   get(1093)
    },
    _usdaName: f.description.toLowerCase(),
    glycemic_index: null,
    cooked_conversion_factor: null,
    source: 'USDA FoodData Central',
    _isExternal: true   // flag for UI display
  };
}

function inferDietType(name) {
  const n = name.toLowerCase();
  if (/beef|pork|lamb|chicken|turkey|fish|salmon|tuna|shrimp|prawn|meat/.test(n))
    return 'non_veg';
  if (/egg/.test(n)) return 'egg';
  return 'veg';
}

function inferRoleTags(name, category) {
  const n = (name + ' ' + (category||'')).toLowerCase();
  const tags = [];
  if (/rice|bread|pasta|oat|wheat|flour|grain|cereal|corn|maize/.test(n))
    tags.push('starch_source');
  if (/oil|butter|ghee|fat|lard/.test(n)) tags.push('cooking_fat');
  if (/bean|lentil|chickpea|dal|pea|legume/.test(n)) tags.push('legume_protein');
  if (/milk|yogurt|cheese|paneer|curd|dairy/.test(n)) tags.push('dairy_protein');
  if (/chicken|beef|fish|salmon|tuna|egg|meat|pork|lamb/.test(n))
    tags.push('animal_protein');
  if (/nut|almond|cashew|walnut|seed|peanut/.test(n)) tags.push('nut_seed');
  if (/sugar|honey|syrup|jaggery|sweetener/.test(n)) tags.push('sweetener');
  if (/spinach|broccoli|carrot|tomato|onion|vegetable|salad/.test(n))
    tags.push('vegetable');
  if (/potato|yam|cassava|plantain/.test(n)) tags.push('starchy_vegetable');
  if (/whole.?wheat|whole.?grain|brown.?rice|oat|barley|millet|quinoa/.test(n))
    tags.push('whole_grain');
  return tags.length > 0 ? tags : ['vegetable']; // safe default
}

// ===== Open Food Facts packaged-product source =====
// OFF products carry the same schema as local ingredients (nutrients_per_100g,
// role_tags, food_group) so once registered they resolve identically. Lookups
// are cached in localStorage for 24h to avoid re-hitting the network for the
// same query — OFF search is a slow, community-hosted endpoint.
const OFF_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readOFFCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.ts !== 'number') return null;
    if (Date.now() - entry.ts > OFF_CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch(e) {
    return null;
  }
}

function writeOFFCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
  } catch(e) {
    // localStorage may be full or unavailable (private mode) — caching is a
    // best-effort optimisation, so a failure here is non-fatal.
  }
}

async function searchOpenFoodFacts(query) {
  if (!query || query.length < 2) return [];
  // Serve from the 24h cache before touching the network.
  const cacheKey = 'off_search_' + query;
  const cached = readOFFCache(cacheKey);
  if (cached) return cached;

  const url = `https://world.openfoodfacts.org/cgi/search.pl` +
    `?search_terms=${encodeURIComponent(query)}` +
    `&search_simple=1&action=process&json=1&page_size=8` +
    `&fields=product_name,brands,nutriscore_grade,nova_group,` +
    `nutriments,image_small_url,code,ingredients_text,ingredients_text_en`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const products = (data.products || [])
      .filter(p => p.product_name && p.nutriments)
      .map(p => normaliseOFFProduct(p));
    writeOFFCache(cacheKey, products);
    return products;
  } catch(e) {
    console.warn('Open Food Facts search failed:', e.message);
    return [];
  }
}

async function lookupOFFByBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 1) return null;
    return normaliseOFFProduct(data.product);
  } catch(e) {
    console.warn('OFF barcode lookup failed:', e.message);
    return null;
  }
}

function normaliseOFFProduct(p) {
  const n = p.nutriments || {};
  return {
    id: 'off_' + (p.code || Math.random().toString(36).slice(2)),
    source_code: p.code || '',
    name: p.product_name + (p.brands ? ' (' + p.brands + ')' : ''),
    food_group: 'Packaged product',
    diet_type: 'veg',  // conservative default; OFF data is unreliable for this
    role_tags: inferRoleTags(p.product_name || '', ''),
    nutrients_per_100g: {
      energy_kcal:    Math.round(n['energy-kcal_100g'] || 0),
      protein_g:      Math.round((n['proteins_100g'] || 0) * 10) / 10,
      carbohydrate_g: Math.round((n['carbohydrates_100g'] || 0) * 10) / 10,
      fiber_g:        Math.round((n['fiber_100g'] || 0) * 10) / 10,
      total_fat_g:    Math.round((n['fat_100g'] || 0) * 10) / 10,
      saturated_fat_g: Math.round((n['saturated-fat_100g'] || 0) * 10) / 10,
      sugars_g:       Math.round((n['sugars_100g'] || 0) * 10) / 10,
      sodium_mg:      Math.round((n['sodium_100g'] || 0) * 1000 * 10) / 10
    },
    glycemic_index: null,
    cooked_conversion_factor: null,
    nutriscore: p.nutriscore_grade || null,
    nova_group: p.nova_group || null,
    _rawIngredients: p.ingredients_text || p.ingredients_text_en || '',
    source: 'Open Food Facts',
    _isExternal: true,
    _isPackaged: true
  };
}

// Scoring loops skip ingredients they cannot resolve; warn once per id so
// data problems are visible without spamming the console (score() runs
// many times per recommendation pass).
const _warnedMissingIngredientIds = new Set();
function warnUnresolvedIngredient(id, where) {
  if (_warnedMissingIngredientIds.has(id)) return;
  _warnedMissingIngredientIds.add(id);
  console.warn('Skipping unresolvable ingredient "' + id + '" in ' + where +
    ' — not found in ingredients.json');
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

// When an ingredient item is entered as a cooked weight and the ingredient
// has a cooked_conversion_factor, convert back to the raw/dry weight the
// nutrient data is keyed to. Ingredients with a null factor (fats, dairy,
// vegetables, nuts) have no cooked/raw distinction — use the entered grams.
function effectiveGrams(item, ing) {
  const grams = item.gramAmount || 0;
  if (item.isCooked === true && ing && ing.cooked_conversion_factor != null) {
    return grams / ing.cooked_conversion_factor;
  }
  return grams;
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
  // Captured before any flag is added so the summing loop only iterates the
  // real nutrient keys, never the _hasIncompleteData marker.
  const nutrientKeys = Object.keys(totals);
  let hasIncompleteData = false;

  for (const item of mealItems) {
    let nutrients = null;
    let scale = 0;

    if (item.type === 'ingredient') {
      const ing = _ingById[item.id];
      if (!ing) { warnUnresolvedIngredient(item.id, 'computeMealNutrients'); continue; }
      nutrients = ing.nutrients_per_100g;
      scale = effectiveGrams(item, ing) / 100;
    } else if (item.type === 'dish') {
      const dish = _dishById[item.id];
      if (!dish) continue;
      nutrients = dish.nutrients_per_serving;
      scale = item.servings || 0;
    }

    if (!nutrients) continue;
    // USDA foods report null for nutrients the database is missing. Treat null
    // as 0 for the arithmetic, but flag the meal so the UI can warn that scores
    // may be slightly understated for those items.
    for (const key of nutrientKeys) {
      if (nutrients[key] === null) hasIncompleteData = true;
      totals[key] += (nutrients[key] ?? 0) * scale;
    }
  }

  if (hasIncompleteData) totals._hasIncompleteData = true;
  return totals;
}
