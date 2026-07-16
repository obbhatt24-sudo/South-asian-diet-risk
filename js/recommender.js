// recommender.js — candidate-finding logic for recommendations. Pure functions, no DOM.

// Flag → intervention mapping (facet doc 04 §4)
const FLAG_INTERVENTIONS = {
  high_glycemic_load: { intervention: 'replace', sourceTag: 'starch_source', targetTag: 'starch_source' },
  high_refined_carb_share: { intervention: 'replace', sourceTag: 'starch_source', targetTag: 'starch_source' },
  low_fiber: { intervention: 'add', sourceTag: null, targetTag: null },
  poor_protein_quality: { intervention: 'add', sourceTag: null, targetTag: null },
  high_saturated_fat: { intervention: 'reduce', sourceTag: 'cooking_fat', targetTag: null },
  poor_fat_quality: { intervention: 'replace', sourceTag: 'cooking_fat', targetTag: 'cooking_fat' },
  high_sodium: { intervention: 'reduce', sourceTag: null, targetTag: null }
};

const FALLBACK_TIPS = {
  low_fiber: 'Add a vegetable side or a small dal to this meal.',
  poor_protein_quality: 'Add a small portion of dal or curd to this meal.',
  high_sodium: 'Reduce added salt during cooking.'
};

// Walks every ingredient in the meal, including those inside dishes,
// calling visit(ing, scale, fromDishId) where scale converts
// nutrients_per_100g to the actual contributed amount.
function forEachMealIngredient(mealItems, visit) {
  for (const item of mealItems) {
    if (item.type === 'ingredient') {
      const ing = getIngredientById(item.id);
      if (!ing) { warnUnresolvedIngredient(item.id, 'forEachMealIngredient'); continue; }
      visit(ing, (item.gramAmount || 0) / 100, null);
    } else if (item.type === 'dish') {
      const dish = getDishById(item.id);
      if (!dish) continue;
      for (const di of dish.ingredients) {
        const ing = getIngredientById(di.ingredient_id);
        if (!ing) { warnUnresolvedIngredient(di.ingredient_id, 'forEachMealIngredient'); continue; }
        const scale = (di.amount_g / 100) * ((item.servings || 0) / dish.servings);
        visit(ing, scale, dish.id);
      }
    }
  }
}

function mealHasNonVeg(mealItems) {
  let hasNonVeg = false;
  forEachMealIngredient(mealItems, (ing) => {
    if (ing.diet_type === 'non_veg') hasNonVeg = true;
  });
  return hasNonVeg;
}

function mealIngredientIds(mealItems) {
  const ids = new Set();
  forEachMealIngredient(mealItems, (ing) => ids.add(ing.id));
  return ids;
}

// MUFA:SFA ratio for a single ingredient (amount-independent).
function ingredientMufaSfaRatio(ing) {
  return getMufaSfaRatio([{ type: 'ingredient', id: ing.id, gramAmount: 100 }]).ratio;
}

function findSourceIngredient(flag, mealItems) {
  const mapping = FLAG_INTERVENTIONS[flag];
  if (!mapping) return null;

  // Flags about what's missing have no source ingredient.
  if (flag === 'low_fiber' || flag === 'poor_protein_quality') return null;

  // For poor_fat_quality "best" is the LOWEST ratio; everywhere else the
  // highest contribution to the flagged nutrient.
  const lowestWins = flag === 'poor_fat_quality';
  let best = null;
  let bestValue = null;

  forEachMealIngredient(mealItems, (ing, scale, fromDishId) => {
    if (mapping.sourceTag && !ing.role_tags.includes(mapping.sourceTag)) return;
    if (flag === 'high_refined_carb_share' && ing.role_tags.includes('whole_grain')) return;

    let value = null;
    if (flag === 'high_glycemic_load' || flag === 'high_refined_carb_share') {
      const gi = getGI(ing.id);
      const carbG = ing.nutrients_per_100g.carbohydrate_g * scale;
      value = flag === 'high_glycemic_load'
        ? (gi === null ? null : gi * carbG)
        : carbG;
    } else if (flag === 'high_saturated_fat') {
      value = ing.nutrients_per_100g.saturated_fat_g * scale;
    } else if (flag === 'poor_fat_quality') {
      value = ingredientMufaSfaRatio(ing);
    } else if (flag === 'high_sodium') {
      value = (ing.nutrients_per_100g.sodium_mg || 0) * scale;
    }

    if (value === null) return;
    if (bestValue === null || (lowestWins ? value < bestValue : value > bestValue)) {
      bestValue = value;
      best = { ingredientRecord: ing, fromDishId };
    }
  });

  return best;
}

function findReplaceTarget(flag, sourceIngredient, mealItems, context) {
  const mapping = FLAG_INTERVENTIONS[flag];
  if (!mapping || !mapping.targetTag) return null;

  const sourceRecord = sourceIngredient && sourceIngredient.ingredientRecord
    ? sourceIngredient.ingredientRecord
    : sourceIngredient;
  if (!sourceRecord) return null;

  const allowNonVeg = mealHasNonVeg(mealItems);
  const sourceGI = getGI(sourceRecord.id);

  const candidates = getAllIngredients().filter((ing) => {
    if (ing.id === sourceRecord.id) return false;
    if (!ing.role_tags.includes(mapping.targetTag)) return false;
    if (!allowNonVeg && ing.diet_type === 'non_veg') return false;

    const name = ing.name.toLowerCase();
    if (mapping.targetTag === 'starch_source' && context === 'india' && name.includes('quinoa')) return false;
    if (mapping.targetTag === 'cooking_fat' && context !== 'us' && name.includes('olive')) return false;

    if (flag === 'high_glycemic_load') {
      const gi = getGI(ing.id);
      return gi !== null && sourceGI !== null && gi < sourceGI;
    }
    if (flag === 'high_refined_carb_share') {
      return ing.role_tags.includes('whole_grain');
    }
    if (flag === 'poor_fat_quality') {
      const ratio = ingredientMufaSfaRatio(ing);
      return ratio !== null && ratio > 1.5;
    }
    return true;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (flag === 'poor_fat_quality') {
      return (ingredientMufaSfaRatio(b) ?? 0) - (ingredientMufaSfaRatio(a) ?? 0);
    }
    // GL and refined-carb flags: lowest GI first
    return (getGI(a.id) ?? Infinity) - (getGI(b.id) ?? Infinity);
  });

  return candidates[0];
}

function findAddTarget(flag, mealItems, context) {
  const tags = flag === 'low_fiber'
    ? ['vegetable', 'legume_protein']
    : flag === 'poor_protein_quality'
      ? ['legume_protein', 'dairy_protein']
      : null;
  if (!tags) return null;

  const inMeal = mealIngredientIds(mealItems);
  const allowNonVeg = mealHasNonVeg(mealItems);

  const candidates = getAllIngredients().filter((ing) => {
    if (inMeal.has(ing.id)) return false;
    if (!allowNonVeg && ing.diet_type === 'non_veg') return false;
    return tags.some((tag) => ing.role_tags.includes(tag));
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (flag === 'low_fiber') {
      return b.nutrients_per_100g.fiber_g - a.nutrients_per_100g.fiber_g;
    }
    // poor_protein_quality: prefer legume_protein, then highest protein
    const aLegume = a.role_tags.includes('legume_protein') ? 1 : 0;
    const bLegume = b.role_tags.includes('legume_protein') ? 1 : 0;
    if (aLegume !== bLegume) return bLegume - aLegume;
    return b.nutrients_per_100g.protein_g - a.nutrients_per_100g.protein_g;
  });

  const target = candidates[0];
  const portionTag = ['legume_protein', 'dairy_protein', 'vegetable']
    .find((tag) => target.role_tags.includes(tag));
  return {
    ingredientRecord: target,
    standardPortion: ADD_PORTIONS[portionTag] ?? null
  };
}

function makeCandidate(fields) {
  return {
    flag: fields.flag,
    intervention: fields.intervention,
    sourceId: fields.sourceId ?? null,
    sourceName: fields.sourceName ?? null,
    targetId: fields.targetId ?? null,
    targetName: fields.targetName ?? null,
    instructionText: fields.instructionText,
    standardPortion: fields.standardPortion ?? null,
    fromOverride: fields.fromOverride ?? false,
    fromDishId: fields.fromDishId ?? null
  };
}

function findCandidate(flag, mealItems, context) {
  const mapping = FLAG_INTERVENTIONS[flag];
  if (!mapping) return null;

  const source = findSourceIngredient(flag, mealItems);
  const sourceRecord = source ? source.ingredientRecord : null;

  // Step 1: curated overrides take precedence over generic matching.
  const override = getRecOverrides().find((o) =>
    o.flag === flag &&
    (o.source_ingredient_id === null || o.source_ingredient_id === sourceRecord?.id)
  );
  if (override) {
    const overrideTarget = override.target_ingredient_id
      ? getIngredientById(override.target_ingredient_id)
      : null;
    // Override 'add' candidates need a portion size for delta preview and
    // Apply, same as generic add candidates (see findAddTarget).
    let overridePortion = null;
    if (override.intervention === 'add' && overrideTarget) {
      const portionTag = ['legume_protein', 'dairy_protein', 'vegetable']
        .find((tag) => overrideTarget.role_tags.includes(tag));
      overridePortion = ADD_PORTIONS[portionTag] ?? null;
    }
    return makeCandidate({
      standardPortion: overridePortion,
      flag,
      intervention: override.intervention,
      sourceId: override.source_ingredient_id,
      sourceName: override.source_ingredient_id
        ? getIngredientById(override.source_ingredient_id)?.name ?? null
        : null,
      targetId: override.target_ingredient_id,
      targetName: overrideTarget?.name ?? null,
      instructionText: override.instruction_text,
      fromOverride: true,
      fromDishId: override.source_ingredient_id === sourceRecord?.id
        ? source?.fromDishId ?? null
        : null
    });
  }

  // Step 2: generic matching via the flag → intervention mapping.
  if (mapping.intervention === 'replace') {
    if (!sourceRecord) return null;
    const target = findReplaceTarget(flag, source, mealItems, context);
    if (target) {
      return makeCandidate({
        flag,
        intervention: 'replace',
        sourceId: sourceRecord.id,
        sourceName: sourceRecord.name,
        targetId: target.id,
        targetName: target.name,
        instructionText: `Swap ${sourceRecord.name} for ${target.name}.`,
        fromDishId: source.fromDishId
      });
    }
    // No suitable target — fall back to reducing the source.
    return makeCandidate({
      flag,
      intervention: 'reduce',
      sourceId: sourceRecord.id,
      sourceName: sourceRecord.name,
      instructionText: `Reduce the amount of ${sourceRecord.name} — try about half the usual quantity.`,
      fromDishId: source.fromDishId
    });
  }

  if (mapping.intervention === 'add') {
    const target = findAddTarget(flag, mealItems, context);
    if (target) {
      return makeCandidate({
        flag,
        intervention: 'add',
        targetId: target.ingredientRecord.id,
        targetName: target.ingredientRecord.name,
        instructionText: `Add ${target.ingredientRecord.name} (about ${target.standardPortion}g) to this meal.`,
        standardPortion: target.standardPortion
      });
    }
    return makeCandidate({
      flag,
      intervention: 'add',
      instructionText: FALLBACK_TIPS[flag]
    });
  }

  if (mapping.intervention === 'reduce') {
    if (sourceRecord) {
      return makeCandidate({
        flag,
        intervention: 'reduce',
        sourceId: sourceRecord.id,
        sourceName: sourceRecord.name,
        instructionText: `Reduce the amount of ${sourceRecord.name} — try about half the usual quantity.`,
        fromDishId: source.fromDishId
      });
    }
    if (FALLBACK_TIPS[flag]) {
      return makeCandidate({
        flag,
        intervention: 'reduce',
        instructionText: FALLBACK_TIPS[flag]
      });
    }
    return null;
  }

  return null;
}

// Expands a dish meal item into its equivalent list of ingredient items,
// scaled to the servings actually eaten. Also used by the Apply button.
function explodeDish(dishItem) {
  const dish = getDishById(dishItem.id);
  return dish.ingredients.map((di) => ({
    type: 'ingredient',
    id: di.ingredient_id,
    gramAmount: di.amount_g * (dishItem.servings / dish.servings)
  }));
}

const T2D_FLAGS = ['high_glycemic_load', 'high_refined_carb_share', 'low_fiber', 'poor_protein_quality'];

// Scores the meal with and without the candidate intervention applied.
// Returns { delta, previewScore, scoreName, modifiedResult } where delta is
// how many points the relevant score would drop (positive = improvement).
function computeDeltaScore(candidate, mealItems, addedSodiumMg, context, pc) {
  let modifiedItems;

  if (candidate.intervention === 'add') {
    modifiedItems = [
      ...mealItems,
      { type: 'ingredient', id: candidate.targetId, gramAmount: candidate.standardPortion }
    ];
  } else if (candidate.fromDishId) {
    // Source is inside a dish: for delta computation only (not Apply),
    // swap the dish item for its exploded ingredients and modify the source there.
    modifiedItems = mealItems.flatMap((item) => {
      if (item.type !== 'dish' || item.id !== candidate.fromDishId) return [item];
      return explodeDish(item).map((ing) => {
        if (ing.id !== candidate.sourceId) return ing;
        return candidate.intervention === 'reduce'
          ? { ...ing, gramAmount: ing.gramAmount * 0.5 }
          : { ...ing, id: candidate.targetId };
      });
    });
  } else {
    modifiedItems = mealItems.map((item) => {
      if (item.id !== candidate.sourceId) return item;
      return candidate.intervention === 'reduce'
        ? { ...item, gramAmount: item.gramAmount * 0.5 }
        : { ...item, id: candidate.targetId };
    });
  }

  const currentResult = score(mealItems, addedSodiumMg, context, pc);
  const modifiedResult = score(modifiedItems, addedSodiumMg, context, pc);

  let scoreName;
  if (candidate.flag === 'low_fiber') {
    // low_fiber affects both scores — report against whichever improves more.
    const diabetesDelta = currentResult.diabetes.score - modifiedResult.diabetes.score;
    const cvdDelta = currentResult.cvd.score - modifiedResult.cvd.score;
    scoreName = diabetesDelta >= cvdDelta ? 'diabetes' : 'cvd';
  } else {
    scoreName = T2D_FLAGS.includes(candidate.flag) ? 'diabetes' : 'cvd';
  }

  const delta = currentResult[scoreName].score - modifiedResult[scoreName].score;
  const previewScore = modifiedResult[scoreName].score;

  return { delta, previewScore, scoreName, modifiedResult };
}

// Builds the final top-3 recommendation list from both scores' flags.
function recommend(diabetesResult, cvdResult, mealItems, addedSodiumMg, context, pc) {
  const allFlags = [...new Set([...diabetesResult.flags, ...cvdResult.flags])];

  const candidates = [];
  for (const flag of allFlags) {
    const candidate = findCandidate(flag, mealItems, context);
    if (!candidate) continue;
    const { delta, previewScore, scoreName } = computeDeltaScore(
      candidate, mealItems, addedSodiumMg, context, pc
    );
    if (delta < 3) continue; // floor: sub-3pt improvement not shown
    candidates.push({ ...candidate, delta, previewScore, scoreName });
  }

  // Deduplicate: if two candidates share a sourceId (or targetId for adds),
  // keep the one with the higher delta.
  const seen = new Map();
  for (const c of candidates) {
    const key = c.sourceId ?? ('add_' + c.targetId);
    if (!seen.has(key) || seen.get(key).delta < c.delta) {
      seen.set(key, c);
    }
  }

  // Sort: higher delta first. Tie-break: prefer replace/add over reduce.
  return [...seen.values()]
    .sort((a, b) => {
      if (b.delta !== a.delta) return b.delta - a.delta;
      const rank = { replace: 0, add: 0, reduce: 1 };
      return (rank[a.intervention] ?? 1) - (rank[b.intervention] ?? 1);
    })
    .slice(0, 3);
}
