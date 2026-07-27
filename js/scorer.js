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

// Carbohydrate (g) at which the carb-quality penalties (refined carb, low fiber,
// low protein) reach full weight; below this they scale down proportionally.
// This stops a small plain-starch portion from stacking the full absence
// penalties on top of its glycemic-load score — the glycemic load already
// scales with carbohydrate, so a 50g-dry rice side should read Moderate while a
// large refined-carb-heavy plate still climbs into High. FAT_QUALITY_REF_G does
// the same for fat quality: a little poor-quality fat (10g ghee in a dal) is a
// smaller insult than a plate cooked in it. Saturated-fat and sodium sub-scores
// already scale with absolute grams/mg, so they are left unscaled.
const CARB_QUALITY_REF_G = 100;
const FAT_QUALITY_REF_G = 30;

// ADR-08: dish GL is computed from the dish's ingredient list, not a dish-level GI.
function computeMealGL(mealItems) {
  let gl = 0;

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = getIngredientById(item.id);
      if (!ing) { warnUnresolvedIngredient(item.id, 'computeMealGL'); continue; }
      const carbG = ing.nutrients_per_100g.carbohydrate_g * (effectiveGrams(item, ing) / 100);
      const gi = getGI(item.id);
      if (gi === null) continue;
      gl += (gi * carbG) / 100;
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) { warnUnresolvedIngredient(di.ingredient_id, 'computeMealGL'); continue; }
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

// Continuous piecewise-linear so that a GL improvement always shows up as a
// score delta — hard buckets flattened real swaps (e.g. white -> basmati rice).
function glSubScore(gl) {
  if (gl <= 0) return 0;
  if (gl <= 10) return gl * 1.0;             // 0-10 -> 0-10 pts
  if (gl <= 20) return 10 + (gl - 10) * 1.5; // 10-20 -> 10-25 pts
  if (gl <= 40) return 25 + (gl - 20) * 0.5; // 20-40 -> 25-35 pts
  return Math.min(40, 35 + (gl - 40) * 0.1); // 40+ -> 35-40 pts (asymptote)
}

const STARCH_ROLE_TAGS = ['starch_source', 'sweetener'];

// Only starch/sweetener ingredients belong in this ratio at all. Dal, rajma,
// spinach and potato carry carbs but no whole_grain tag, and counting them as
// refined was scoring legume- and vegetable-heavy meals as if they were sugar.
function refinedCarbShare(mealItems) {
  let totalStarchCarbs = 0;
  let refinedCarbs = 0;

  const accumulate = (ing, scale) => {
    const hasStarchRole = ing.role_tags.some((tag) => STARCH_ROLE_TAGS.includes(tag));
    if (!hasStarchRole) return;
    const carbG = ing.nutrients_per_100g.carbohydrate_g * scale;
    totalStarchCarbs += carbG;
    if (!ing.role_tags.includes('whole_grain')) refinedCarbs += carbG;
  };

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = getIngredientById(item.id);
      if (!ing) { warnUnresolvedIngredient(item.id, 'refinedCarbShare'); continue; }
      accumulate(ing, item.gramAmount / 100);
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) { warnUnresolvedIngredient(di.ingredient_id, 'refinedCarbShare'); continue; }
        accumulate(ing, (di.amount_g / 100) * (item.servings / dish.servings));
      }
    }
  }

  if (totalStarchCarbs === 0) return 0;
  return refinedCarbs / totalStarchCarbs;
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
      if (!ing) { warnUnresolvedIngredient(item.id, 'proteinQualityShare'); continue; }
      const proteinG = ing.nutrients_per_100g.protein_g * (item.gramAmount / 100);
      totalProtein += proteinG;
      if (isQuality(ing)) qualityProtein += proteinG;
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      totalProtein += dish.nutrients_per_serving.protein_g * item.servings;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) { warnUnresolvedIngredient(di.ingredient_id, 'proteinQualityShare'); continue; }
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

function fiberSubScore(fiberG) {
  if (fiberG >= 6) return 0;
  if (fiberG >= 4) return 5;
  if (fiberG >= 2) return 12;
  return 20;
}

function getBmiMultiplier(bmiCategory) {
  switch (bmiCategory) {
    case 'overweight': return 1.1;
    case 'obese': return 1.2;
    default: return 1.0;
  }
}

function diabetesScore(mealItems, context, personalContext) {
  const nutrients = computeMealNutrients(mealItems);
  const gl = computeMealGL(mealItems);
  const refShare = refinedCarbShare(mealItems);
  const protShare = proteinQualityShare(mealItems);

  // Carb-quality penalties scale with the carbohydrate the meal delivers (see
  // CARB_QUALITY_REF_G). Glycemic load is not scaled — it already depends on
  // carbohydrate. Sub-scores are rounded so the breakdown UI shows whole points.
  const carbScale = Math.min(1, nutrients.carbohydrate_g / CARB_QUALITY_REF_G);

  const subScores = {
    glycemic_load: Math.round(glSubScore(gl)),
    refined_carb: Math.round(refinedCarbSubScore(refShare, context) * carbScale),
    fiber: Math.round(fiberSubScore(nutrients.fiber_g) * carbScale),
    protein_quality: Math.round(proteinQualitySubScore(protShare) * carbScale)
  };

  const rawSum = Object.values(subScores).reduce((sum, v) => sum + v, 0);

  const bmiMult = getBmiMultiplier(personalContext.bmiCategory);
  const t2dMult = personalContext.t2dFamilyHistory === true ? 1.15 : 1.0;
  const finalScore = Math.min(100, Math.round(rawSum * bmiMult * t2dMult));

  const band = finalScore < 35 ? 'Low' : finalScore < 65 ? 'Moderate' : 'High';

  const flags = [];
  if (subScores.glycemic_load > 0) flags.push('high_glycemic_load');
  if (subScores.refined_carb > 0) flags.push('high_refined_carb_share');
  if (subScores.fiber > 0) flags.push('low_fiber');
  if (subScores.protein_quality > 0) flags.push('poor_protein_quality');

  return { score: finalScore, band, subScores, flags, gl, refShare, protShare };
}

function sfaSubScore(sfaG) {
  if (sfaG < 4) return 0;
  if (sfaG < 8) return 15;
  if (sfaG < 12) return 28;
  return 40;
}

// Few ingredients carry a measured mufa_g, so most fall back to the
// MUFA_SFA_FALLBACK ratio table keyed by lowercase ingredient name.
function getMufaSfaRatio(mealItems) {
  let totalSfa = 0;
  let totalMufa = 0;
  let usedFallback = false;

  const accumulate = (ing, scale) => {
    const sfa = ing.nutrients_per_100g.saturated_fat_g * scale;
    totalSfa += sfa;
    if (ing.nutrients_per_100g.mufa_g !== undefined && ing.nutrients_per_100g.mufa_g !== null) {
      totalMufa += ing.nutrients_per_100g.mufa_g * scale;
    } else {
      let fallbackRatio;
      if (ing._isExternal && ing._usdaName) {
        // USDA foods carry no MUFA data and name their oils "Oil, olive, ..."
        // (word order reversed from our table's "olive oil"), so match a
        // fallback key when ALL its words appear anywhere in the USDA name,
        // order-independent (e.g. 'olive oil' matches 'oil, olive, extra virgin').
        const nameWords = new Set(ing._usdaName.split(/[^a-z]+/).filter(Boolean));
        const matchKey = Object.keys(MUFA_SFA_FALLBACK)
          .find((k) => k.split(' ').every((w) => nameWords.has(w)));
        fallbackRatio = matchKey
          ? MUFA_SFA_FALLBACK[matchKey]
          : MUFA_SFA_FALLBACK_DEFAULT;
      } else {
        fallbackRatio =
          MUFA_SFA_FALLBACK[ing.name.toLowerCase()] ?? MUFA_SFA_FALLBACK_DEFAULT;
      }
      totalMufa += sfa * fallbackRatio;
      usedFallback = true;
    }
  };

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = getIngredientById(item.id);
      if (!ing) { warnUnresolvedIngredient(item.id, 'getMufaSfaRatio'); continue; }
      accumulate(ing, item.gramAmount / 100);
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) { warnUnresolvedIngredient(di.ingredient_id, 'getMufaSfaRatio'); continue; }
        accumulate(ing, (di.amount_g / 100) * (item.servings / dish.servings));
      }
    }
  }

  if (totalSfa === 0) return { ratio: null, usedFallback: false };
  return { ratio: totalMufa / totalSfa, usedFallback };
}

function fatQualitySubScore(ratio) {
  if (ratio === null) return null;
  if (ratio > 2.0) return 0;
  if (ratio >= 1.0) return 12;
  if (ratio >= 0.5) return 22;
  return 30;
}

function sodiumSubScore(sodiumMg) {
  if (sodiumMg === null) return null;
  if (sodiumMg < 400) return 0;
  if (sodiumMg < 751) return 3;
  if (sodiumMg < 1201) return 7;
  return 10;
}

function cvdScore(mealItems, addedSodiumMg, context, personalContext) {
  const nutrients = computeMealNutrients(mealItems);
  const totalSodium = addedSodiumMg !== null
    ? nutrients.sodium_mg + addedSodiumMg
    : null;

  const { ratio, usedFallback } = getMufaSfaRatio(mealItems);
  const sodiumSub = sodiumSubScore(totalSodium);
  const fatQualSub = fatQualitySubScore(ratio);

  // Fat-quality penalty scales with total fat, fiber penalty with carbohydrate
  // (see CARB_QUALITY_REF_G / FAT_QUALITY_REF_G). Saturated fat and sodium are
  // left unscaled — they already scale with absolute grams/mg.
  const carbScale = Math.min(1, nutrients.carbohydrate_g / CARB_QUALITY_REF_G);
  const fatScale = Math.min(1, nutrients.total_fat_g / FAT_QUALITY_REF_G);

  const subScores = {
    saturated_fat: sfaSubScore(nutrients.saturated_fat_g),
    fat_quality: fatQualSub === null ? null : Math.round(fatQualSub * fatScale),
    fiber: Math.round(fiberSubScore(nutrients.fiber_g) * carbScale),
    sodium: sodiumSub // may be null
  };

  // Sum only non-null sub-scores
  const rawSum = Object.values(subScores).reduce((sum, v) => sum + (v ?? 0), 0);

  const bmiMult = getBmiMultiplier(personalContext.bmiCategory);
  const cvdMult = personalContext.cvdFamilyHistory === true ? 1.15 : 1.0;
  const finalScore = Math.min(100, Math.round(rawSum * bmiMult * cvdMult));

  const band = finalScore < 35 ? 'Low' : finalScore < 65 ? 'Moderate' : 'High';

  const flags = [];
  if (subScores.saturated_fat > 0) flags.push('high_saturated_fat');
  if (subScores.fat_quality !== null && subScores.fat_quality > 0) flags.push('poor_fat_quality');
  if (subScores.fiber > 0) flags.push('low_fiber');
  if (sodiumSub !== null && sodiumSub > 0) flags.push('high_sodium');

  return {
    score: finalScore,
    band,
    subScores,
    flags,
    ratio,
    usedFallback,
    totalSodium
  };
}

// Master entry point — the rest of the app only ever calls score().
function score(mealItems, addedSodiumMg, context, personalContext) {
  return {
    diabetes: diabetesScore(mealItems, context, personalContext),
    cvd: cvdScore(mealItems, addedSodiumMg, context, personalContext)
  };
}
