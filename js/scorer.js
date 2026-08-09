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

// Step 71: dairy SFA (paneer, curd, milk, yogurt) carries a different
// cardiovascular risk profile than SFA from other sources per recent
// dairy-matrix evidence. When dairy sources supply most of a meal's
// saturated fat, the saturated_fat sub-score gets a partial exemption
// instead of the full penalty.
const DAIRY_SFA_SHARE_THRESHOLD = 0.70;
const DAIRY_SFA_EXEMPTION_FACTOR = 0.85; // sub-score * this = 15% reduction

// Step 71: T1D "dosing complexity" mode — fat and protein slow gastric
// emptying and delay a meal's glucose rise by 2-4 hours, which the standard
// glycemic-load framing does not capture. These thresholds flag meals likely
// to need an extended/dual-wave bolus.
const T1D_FAT_DELAY_THRESHOLD_G = 20;
const T1D_PROTEIN_DELAY_THRESHOLD_G = 25;

// ===== Step 66 — cooking method modifiers =====
// Cooking methods change how a starch/legume/vegetable scores. We attach a
// _modifiedIngredient to each ingredient item that carries a cooking_method so
// the nutrient/GL computations below read the modified ingredient transparently
// (they fall back to getIngredientById when none is attached).
//
// The per-100g nutrient block is intentionally NOT mutated: GI is applied via a
// _modifiedGI field (computeMealGL uses it in place of getGI), and the fat that
// frying/tempering adds is applied separately by cookingAddedFat() so the shared
// ingredient records stay pristine. NOTE: the Step-65 cooking-modifiers.js
// helper (applycooking_modifier) operates on a flat gi/carb_g/fat_g shape that
// does not match our nutrients_per_100g records, so the working logic lives here.
function applyCookingModifierToIngredient(ing, methodId) {
  const method = (_cookingMethods || []).find((m) => m.id === methodId);
  if (!method) return ing;
  const modified = { ...ing, _cookingMethodId: methodId, _cookingNote: method.note };
  const baseGI = getGI(ing.id);
  if (baseGI !== null && method.gi_multiplier && method.gi_multiplier !== 1.0) {
    modified._modifiedGI = Math.round(baseGI * method.gi_multiplier);
  }
  return modified;
}

function applyAllCookingModifiers(mealItems) {
  return mealItems.map((item) => {
    if (item.type !== 'ingredient' || !item.cooking_method) return item;
    const ing = getIngredientById(item.id);
    if (!ing) return item;
    return { ...item, _modifiedIngredient: applyCookingModifierToIngredient(ing, item.cooking_method) };
  });
}

// Fat (and saturated fat) contributed purely by the cooking method — deep or
// shallow frying, oil tempering — scaled to each item's effective grams. Kept
// separate from computeMealNutrients so the per-100g data is never mutated.
function cookingAddedFat(mealItems) {
  let total_fat_g = 0;
  let saturated_fat_g = 0;
  for (const item of mealItems) {
    if (item.type !== 'ingredient' || !item.cooking_method) continue;
    const method = (_cookingMethods || []).find((m) => m.id === item.cooking_method);
    if (!method || !method.fat_add_per_100g) continue;
    const ing = getIngredientById(item.id);
    const scale = effectiveGrams(item, ing) / 100;
    total_fat_g += method.fat_add_per_100g * scale;
    saturated_fat_g += (method.saturated_fat_add_per_100g || 0) * scale;
  }
  return { total_fat_g, saturated_fat_g };
}

// ADR-08: dish GL is computed from the dish's ingredient list, not a dish-level GI.
function computeMealGL(mealItems) {
  let gl = 0;

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = item._modifiedIngredient || getIngredientById(item.id);
      if (!ing) { warnUnresolvedIngredient(item.id, 'computeMealGL'); continue; }
      const carbG = ing.nutrients_per_100g.carbohydrate_g * (effectiveGrams(item, ing) / 100);
      const gi = ing._modifiedGI != null ? ing._modifiedGI : getGI(item.id);
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
      const ing = item._modifiedIngredient || getIngredientById(item.id);
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

// India: moderate band starts at 25% refined carb share; US: 20%. Step 71:
// T1D mode is not modulated by population context, so it uses the midpoint
// rather than either India/US threshold.
function refinedCarbSubScore(share, context) {
  const modThreshold = context === 'india' ? 0.25 : context === 'us' ? 0.20 : 0.225;
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
      const ing = item._modifiedIngredient || getIngredientById(item.id);
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

// Step 71: raised from >=6/>=3/<3 to >=8/>=4/<4 (Reynolds et al. 2019).
function fiberSubScore(fiberG) {
  if (fiberG >= 8) return 0;
  if (fiberG >= 4) return 5;
  return 20;
}

// Step 71: T1D-only sub-score. Higher fat/protein delays the glucose rise
// (gastric emptying), so it is scored independently of glycemic load rather
// than folded into it.
function fatProteinImpactSubScore(fatG, proteinG) {
  const raw = (fatG * 0.6 + proteinG * 0.4) / 10;
  return Math.max(0, Math.min(20, raw));
}

function getBmiMultiplier(bmiCategory) {
  switch (bmiCategory) {
    case 'overweight': return 1.1;
    case 'obese': return 1.2;
    default: return 1.0;
  }
}

function diabetesScore(mealItems, context, personalContext) {
  // Cooking methods change GI (and thus glycemic load); carbohydrate and fibre
  // are unchanged, so the nutrient totals are read from the unmodified items.
  const items = applyAllCookingModifiers(mealItems);
  const nutrients = computeMealNutrients(mealItems);
  const gl = computeMealGL(items);
  const refShare = refinedCarbShare(items);
  const protShare = proteinQualityShare(items);

  // Carb-quality penalties scale with the carbohydrate the meal delivers (see
  // CARB_QUALITY_REF_G). Glycemic load is not scaled — it already depends on
  // carbohydrate. Sub-scores are rounded so the breakdown UI shows whole points.
  const carbScale = Math.min(1, nutrients.carbohydrate_g / CARB_QUALITY_REF_G);

  // Step 71: T1D mode reframes this as dosing complexity rather than
  // long-term risk contribution and adds a fat/protein delayed-rise
  // sub-score. It is not scaled by carbScale — it reflects the meal's
  // absolute fat/protein load, which drives delayed absorption regardless
  // of how much carbohydrate is also present.
  const isT1D = context === 't1d';

  const subScores = {
    glycemic_load: Math.round(glSubScore(gl)),
    refined_carb: Math.round(refinedCarbSubScore(refShare, context) * carbScale),
    fiber: Math.round(fiberSubScore(nutrients.fiber_g) * carbScale),
    protein_quality: Math.round(proteinQualitySubScore(protShare) * carbScale)
  };
  if (isT1D) {
    subScores.fat_protein_impact = Math.round(
      fatProteinImpactSubScore(nutrients.total_fat_g, nutrients.protein_g)
    );
  }

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

  const result = {
    score: finalScore,
    band,
    subScores,
    flags,
    gl,
    refShare,
    protShare,
    type: isT1D ? 'dosing_complexity' : 'risk_contribution'
  };
  if (isT1D) {
    result.fat_protein_delay_flag =
      nutrients.total_fat_g > T1D_FAT_DELAY_THRESHOLD_G ||
      nutrients.protein_g > T1D_PROTEIN_DELAY_THRESHOLD_G;
  }
  return result;
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
      const ing = item._modifiedIngredient || getIngredientById(item.id);
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

// Step 71: share of the meal's saturated fat contributed by dairy sources
// (paneer, curd, milk, yogurt — identified by food_group, not ghee/butter,
// which are classified as 'Fats and Oils'). Used to grant the SFA sub-score
// a partial exemption when dairy dominates the meal's saturated fat.
function dairySfaShare(mealItems) {
  let totalSfa = 0;
  let dairySfa = 0;

  const accumulate = (ing, scale) => {
    const sfa = ing.nutrients_per_100g.saturated_fat_g * scale;
    totalSfa += sfa;
    if ((ing.food_group || '').toLowerCase() === 'dairy') dairySfa += sfa;
  };

  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = item._modifiedIngredient || getIngredientById(item.id);
      if (!ing) { warnUnresolvedIngredient(item.id, 'dairySfaShare'); continue; }
      accumulate(ing, item.gramAmount / 100);
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) { warnUnresolvedIngredient(di.ingredient_id, 'dairySfaShare'); continue; }
        accumulate(ing, (di.amount_g / 100) * (item.servings / dish.servings));
      }
    }
  }

  if (totalSfa === 0) return 0;
  return dairySfa / totalSfa;
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
  const items = applyAllCookingModifiers(mealItems);
  const nutrients = computeMealNutrients(mealItems);
  const totalSodium = addedSodiumMg !== null
    ? nutrients.sodium_mg + addedSodiumMg
    : null;

  // Frying / tempering adds fat on top of the raw ingredient's own fat; fold it
  // into the saturated-fat sub-score and the total-fat scaling factor.
  const addedFat = cookingAddedFat(mealItems);
  const totalFatG = nutrients.total_fat_g + addedFat.total_fat_g;
  const saturatedFatG = nutrients.saturated_fat_g + addedFat.saturated_fat_g;

  const { ratio, usedFallback } = getMufaSfaRatio(items);
  const sodiumSub = sodiumSubScore(totalSodium);
  const fatQualSub = fatQualitySubScore(ratio);

  // Step 71: dairy SFA partial exemption — dairy sources (paneer, curd, milk,
  // yogurt) carry a different cardiovascular risk profile than SFA from other
  // sources, so when they supply most of the meal's saturated fat the
  // sub-score is reduced instead of triggering the full penalty.
  const dairyShare = dairySfaShare(items);
  const isDairySfaSource = dairyShare > DAIRY_SFA_SHARE_THRESHOLD;
  let saturatedFatSub = sfaSubScore(saturatedFatG);
  if (isDairySfaSource) {
    saturatedFatSub = Math.round(saturatedFatSub * DAIRY_SFA_EXEMPTION_FACTOR);
  }

  // Fat-quality penalty scales with total fat, fiber penalty with carbohydrate
  // (see CARB_QUALITY_REF_G / FAT_QUALITY_REF_G). Saturated fat and sodium are
  // left unscaled — they already scale with absolute grams/mg.
  const carbScale = Math.min(1, nutrients.carbohydrate_g / CARB_QUALITY_REF_G);
  const fatScale = Math.min(1, totalFatG / FAT_QUALITY_REF_G);

  const subScores = {
    saturated_fat: saturatedFatSub,
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
  if (subScores.saturated_fat > 0) {
    flags.push(isDairySfaSource ? 'high_saturated_fat_dairy_source' : 'high_saturated_fat');
  }
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
    totalSodium,
    dairySfaShare: dairyShare
  };
}

// Step 72: ingredients whose potassium content is protective against high
// blood pressure. The DB keys ingredients as ing_NNN rather than descriptive
// slugs, so this is a mapping to the actual ids (comment names the food).
const POTASSIUM_RICH_IDS = [
  'ing_013', // Chana dal
  'ing_014', // Masoor dal
  'ing_015', // Toor dal
  'ing_016', // Moong dal
  'ing_017', // Spinach
  'ing_019', // Tomato
  'ing_023', // Potato
  'ing_024', // Sweet potato
  'ing_035', // Chickpeas (kabuli chana)
  'ing_036', // Kidney beans (rajma)
  'ing_053', // Chana (whole black, kala chana)
  'ing_067', // Beetroot
  'ing_146'  // Raw banana (kachcha kela)
];

function hypertensionScore(mealItems, addedSodiumMg, context) {
  const nutrients = computeMealNutrients(mealItems);

  // Total sodium including added salt
  const sodiumTotal = (nutrients.sodium_mg || 0) + (addedSodiumMg || 0);

  // SUB-SCORE 1: Sodium (0-50 pts, higher = worse)
  // South Asian threshold: stricter than US due to higher salt sensitivity
  const sodiumThreshold = context === 'india' ? 700 : 800;
  const sodiumScore = sodiumTotal <= sodiumThreshold * 0.5 ? 5
    : sodiumTotal <= sodiumThreshold ? 20
    : sodiumTotal <= sodiumThreshold * 1.5 ? 35
    : 50;

  // SUB-SCORE 2: Potassium-rich foods (0-20 pts, protective — subtracted
  // from the raw score rather than added, since more potassium is better)
  const potassiumItems = mealItems.filter((item) => {
    if (item.type !== 'ingredient') return false;
    const ing = getIngredientById(item.id);
    return ing && (POTASSIUM_RICH_IDS.includes(item.id) ||
      (ing.role_tags && ing.role_tags.includes('potassium_rich')));
  });
  const potassiumGrams = potassiumItems.reduce((sum, item) => sum + item.gramAmount, 0);
  const potassiumProtection = Math.min(20, Math.round(potassiumGrams / 15));

  // SUB-SCORE 3: Saturated fat (0-15 pts)
  const sfaPct = (nutrients.saturated_fat_g * 9) /
    Math.max(nutrients.energy_kcal || 500, 500);
  const sfaScore = sfaPct < 0.07 ? 3 : sfaPct < 0.12 ? 8 : sfaPct < 0.18 ? 12 : 15;

  // SUB-SCORE 4: Added sugar (0-15 pts)
  const sugarG = nutrients.sugars_g || 0;
  const sugarScore = sugarG < 5 ? 2 : sugarG < 15 ? 7 : sugarG < 25 ? 12 : 15;

  const rawScore = sodiumScore + sfaScore + sugarScore - potassiumProtection;
  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore / 0.95)));

  const band = finalScore < 35 ? 'Low' : finalScore < 65 ? 'Moderate' : 'High';

  const flags = [];
  if (sodiumScore >= 35) flags.push('high_sodium');
  if (sfaScore >= 12)    flags.push('high_saturated_fat');
  if (sugarScore >= 12)  flags.push('high_added_sugar');
  if (potassiumProtection < 5) flags.push('low_potassium');

  return {
    score: finalScore,
    band,
    flags,
    subScores: {
      sodium: sodiumScore,
      potassium_protection: potassiumProtection,
      saturated_fat: sfaScore,
      added_sugar: sugarScore
    },
    sodiumMg: sodiumTotal,
    potassiumGrams
  };
}

// Master entry point — the rest of the app only ever calls score().
function score(mealItems, addedSodiumMg, context, personalContext) {
  return {
    diabetes: diabetesScore(mealItems, context, personalContext),
    cvd: cvdScore(mealItems, addedSodiumMg, context, personalContext),
    hypertension: hypertensionScore(mealItems, addedSodiumMg, context)
  };
}
