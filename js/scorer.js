// scorer.js — pure scoring functions. No DOM access, no global state.

const FOOD_GROUP_GI_DEFAULTS = {
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

const MUFA_SFA_FALLBACK = {
  'ghee': 0.4, 'butter': 0.4, 'coconut oil': 0.1,
  'mustard oil': 2.8, 'groundnut oil': 1.9,
  'refined sunflower oil': 0.5, 'palm oil': 0.4,
  'olive oil': 4.5, 'sesame oil': 1.1
};
const MUFA_SFA_FALLBACK_DEFAULT = 0.8;

const ADD_PORTIONS = {
  'legume_protein': 100,
  'dairy_protein': 80,
  'vegetable': 80
};

// ADR-08: dish GL is computed from the dish's ingredient list, not a dish-level GI.
function computeMealGL(mealItems) {
  let gl = 0;

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = getIngredientById(item.id);
      if (!ing) continue;
      const carbG = ing.nutrients_per_100g.carbohydrate_g * (item.gramAmount / 100);
      const gi = getGI(item.id);
      if (gi === null) continue;
      gl += (gi * carbG) / 100;
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) continue;
        const scale = (di.amount_g / 100) * item.servings * (1 / dish.servings);
        const carbG = ing.nutrients_per_100g.carbohydrate_g * scale;
        const gi = getGI(di.ingredient_id);
        if (gi === null) continue;
        gl += (gi * carbG) / 100;
      }
    }
  }

  return gl;
}

function glSubScore(gl) {
  if (gl < 10) return 0;
  if (gl < 20) return 20;
  if (gl < 30) return 32;
  return 40;
}
