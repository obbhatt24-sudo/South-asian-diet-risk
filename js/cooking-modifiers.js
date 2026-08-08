let _cookingMethods = null;

async function loadCookingMethods() {
  if (_cookingMethods) return _cookingMethods;
  const res = await fetch('data/cooking-methods.json');
  _cookingMethods = await res.json();
  return _cookingMethods;
}

function getCookingMethodsForCategory(category) {
  return (_cookingMethods || []).filter(m =>
    m.applies_to.includes(category)
  );
}

function applycooking_modifier(ingredient, methodId, servingGrams) {
  if (!methodId || methodId === 'boiled' || methodId === 'none') {
    return ingredient;  // no modification
  }
  const method = (_cookingMethods || []).find(m => m.id === methodId);
  if (!method) return ingredient;

  const modified = { ...ingredient };

  // Apply GI modifier
  if (modified.gi && method.gi_multiplier) {
    modified.gi = Math.round(modified.gi * method.gi_multiplier);
    // Recompute GL: gl = gi * carb_g / 100
    modified.gl_per_100g = modified.gi * (modified.carb_g || 0) / 100;
  }

  // Apply fat addition (per 100g, scaled to serving)
  if (method.fat_add_per_100g) {
    const scale = servingGrams / 100;
    modified.fat_g = (modified.fat_g || 0) + method.fat_add_per_100g;
    modified.saturated_fat_g = (modified.saturated_fat_g || 0) +
      (method.saturated_fat_add_per_100g || 0);
    // Update energy for added fat (9 kcal per gram)
    modified.energy_kcal = (modified.energy_kcal || 0) +
      method.fat_add_per_100g * 9;
  }

  modified._cooking_method = methodId;
  modified._cooking_note = method.note;
  return modified;
}
