// ml-scorer.js — ML personal risk context (Step 50).
//
// This is NOT a second meal score. It measures where the user sits in the
// population risk distribution based on personal context (age, BMI, activity)
// plus dietary patterns, using a gradient-boosted model trained on NHANES
// 2011–2018. It displays once from the personal-context inputs, independent of
// the rule-based meal score in scorer.js.

const ML_FEATURE_COLS = [
  'feature_age', 'feature_bmi', 'feature_waist_cm', 'feature_sedentary_hrs',
  'feature_glycemic_load', 'feature_refined_carb_share',
  'feature_fiber_per_1000kcal', 'feature_protein_pct_energy',
  'feature_sfa_pct_energy', 'feature_mufa_sfa_ratio', 'feature_sodium_mg'
];

let _mlWeights = null;

async function loadMLWeights() {
  if (_mlWeights) return _mlWeights;
  try {
    const res = await fetch('data/ml_weights.json');
    _mlWeights = await res.json();
    console.log('ML weights loaded. Version:', _mlWeights.version);
    return _mlWeights;
  } catch(e) {
    console.warn('ML weights not available:', e.message);
    return null;
  }
}

function traverseTree(node, x) {
  if ('leaf' in node) return node.leaf;
  return x[node.feature] <= node.threshold
    ? traverseTree(node.left, x)
    : traverseTree(node.right, x);
}

function gbmPredict(weightsBlock, featuresDict) {
  const cols = weightsBlock.feature_cols;
  const x = cols.map(c => featuresDict[c] ?? 0);
  let score = weightsBlock.init_score;
  const lr = weightsBlock.learning_rate;
  for (const stage of weightsBlock.trees) {
    for (const tree of stage) {
      score += lr * traverseTree(tree, x);
    }
  }
  const prob = 1 / (1 + Math.exp(-score));
  const p5  = weightsBlock.calibration.p5;
  const p95 = weightsBlock.calibration.p95;
  return Math.min(100, Math.max(0, Math.round(10 + (prob - p5) / (p95 - p5) * 80)));
}

function buildMLFeatures(personalContext, mealItems, addedSodiumMg) {
  const nutrients = computeMealNutrients(mealItems);
  const gl = computeMealGL(mealItems);
  const DAILY_SCALE = 3;

  return {
    feature_age:                 personalContext.age || 40,
    feature_bmi:                 personalContext.bmi
                                   ? Math.min(Math.max(personalContext.bmi, 15), 60)
                                   : 25,  // default if not entered
    feature_waist_cm:            personalContext.waistCm
                                   ? Math.min(Math.max(personalContext.waistCm, 50), 160)
                                   : (personalContext.bmiCategory === 'obese' ? 102
                                      : personalContext.bmiCategory === 'overweight' ? 90
                                      : 80),  // fallback estimate from BMI category if waist not entered
    feature_sedentary_hrs:       personalContext.sedentaryHrs || 6,
    feature_glycemic_load:       gl * DAILY_SCALE,
    feature_refined_carb_share:  refinedCarbShare(mealItems),
    feature_fiber_per_1000kcal:  (nutrients.fiber_g * DAILY_SCALE) /
                                  Math.max(nutrients.energy_kcal * DAILY_SCALE, 500) * 1000,
    feature_protein_pct_energy:  (nutrients.protein_g * 4 * DAILY_SCALE) /
                                  Math.max(nutrients.energy_kcal * DAILY_SCALE, 500),
    feature_sfa_pct_energy:      (nutrients.saturated_fat_g * 9 * DAILY_SCALE) /
                                  Math.max(nutrients.energy_kcal * DAILY_SCALE, 500),
    feature_mufa_sfa_ratio:      getMufaSfaRatio(mealItems).ratio ?? 0.8,
    feature_sodium_mg:           ((nutrients.sodium_mg || 0) + (addedSodiumMg || 0)) * DAILY_SCALE,
  };
}

async function getMLPersonalRiskContext(personalContext, mealItems, addedSodiumMg) {
  const weights = await loadMLWeights();
  if (!weights) return null;

  const features = buildMLFeatures(personalContext, mealItems, addedSodiumMg);
  const diabetesScore = gbmPredict(weights.diabetes, features);
  const cvdScore      = gbmPredict(weights.cvd, features);
  const band = s => s < 35 ? 'Low' : s < 65 ? 'Moderate' : 'High';

  return {
    diabetes: { score: diabetesScore, band: band(diabetesScore) },
    cvd:      { score: cvdScore,      band: band(cvdScore) },
    features,
    modelInfo: {
      diabetesAUC: weights.diabetes.test_auc,
      cvdAUC:      weights.cvd.test_auc,
      asianDiabetesAUC: weights.diabetes.asian_auc,
      asianCVDAUC:      weights.cvd.asian_auc,
    }
  };
}
