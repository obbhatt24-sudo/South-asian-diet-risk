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

function refinedCarbShare(mealItems) {
  let totalCarbs = 0;
  let refinedCarbs = 0;

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = getIngredientById(item.id);
      if (!ing) continue;
      const carbG = ing.nutrients_per_100g.carbohydrate_g * (item.gramAmount / 100);
      totalCarbs += carbG;
      if (!ing.role_tags.includes('whole_grain')) refinedCarbs += carbG;
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      totalCarbs += dish.nutrients_per_serving.carbohydrate_g * item.servings;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) continue;
        if (ing.role_tags.includes('whole_grain')) continue;
        const scale = (di.amount_g / 100) * (item.servings / dish.servings);
        refinedCarbs += ing.nutrients_per_100g.carbohydrate_g * scale;
      }
    }
  }

  if (totalCarbs === 0) return 0;
  return refinedCarbs / totalCarbs;
}

// India: moderate band starts at 25% refined carb share; US: 20%
function refinedCarbSubScore(share, context) {
  const modThreshold = context === 'india' ? 0.25 : 0.20;
  if (share < modThreshold) return 0;
  if (share < 0.50) return 10;
  if (share < 0.75) return 18;
  return 25;
}

const QUALITY_PROTEIN_TAGS = ['legume_protein', 'dairy_protein', 'animal_protein'];

// All animal_protein counts as quality protein here — a simplification
// noted in the disclaimers.
function proteinQualityShare(mealItems) {
  let totalProtein = 0;
  let qualityProtein = 0;

  const isQuality = (ing) =>
    ing.role_tags.some((tag) => QUALITY_PROTEIN_TAGS.includes(tag));

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = getIngredientById(item.id);
      if (!ing) continue;
      const proteinG = ing.nutrients_per_100g.protein_g * (item.gramAmount / 100);
      totalProtein += proteinG;
      if (isQuality(ing)) qualityProtein += proteinG;
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      totalProtein += dish.nutrients_per_serving.protein_g * item.servings;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) continue;
        if (!isQuality(ing)) continue;
        const scale = (di.amount_g / 100) * (item.servings / dish.servings);
        qualityProtein += ing.nutrients_per_100g.protein_g * scale;
      }
    }
  }

  if (totalProtein === 0) return 0;
  return qualityProtein / totalProtein;
}

function proteinQualitySubScore(share) {
  if (share > 0.30) return 0;
  if (share >= 0.15) return 5;
  if (share >= 0.05) return 10;
  return 15;
}
