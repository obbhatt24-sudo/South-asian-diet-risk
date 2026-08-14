# South Asian Diet Disease-Risk Calculator

An open-source dietary risk scoring tool calibrated to South Asian metabolic risk patterns, validated against NHANES population data.

## Live Demo

**[obbhatt24-sudo.github.io/South-asian-diet-risk](https://obbhatt24-sudo.github.io/South-asian-diet-risk/)**

*(Screenshot of the score results page goes here.)*

## The Problem

South Asians develop type 2 diabetes and cardiovascular disease at younger ages and lower BMIs than Western populations — a phenomenon well documented in the epidemiological literature but almost entirely absent from the training data behind consumer nutrition tools. Standard calorie-tracking apps treat all carbohydrates and fats as metabolically equivalent regardless of who is eating them, ignoring population-specific differences in insulin resistance, body composition, and cardiovascular risk that show up at lower BMI thresholds in South Asian populations than in the Western cohorts most nutrition apps are built around.

This tool does not. Every score — diabetes, cardiovascular, and hypertension — is calibrated against South Asian-specific data sources: glycemic index studies conducted on South Asian foods and cooking methods, ICMR-INDIAB population thresholds for India, and the MASALA cohort for South Asian cardiovascular risk in the US. The goal is a scoring system that reflects how South Asian bodies actually respond to South Asian diets, rather than repurposing thresholds derived from a different population.

## What Makes This Different

- **South Asian-specific scoring** — separate India and US South Asian context modes, not a one-size-fits-all model
- **GI/GL calibrated to published South Asian food studies**, not generic Western glycemic index tables
- **ML personal risk model** trained on the NHANES non-Hispanic Asian subsample (diabetes AUC 0.780, Asian-subsample AUC 0.871)
- **Three disease risk scores**: diabetes, cardiovascular, and hypertension
- **Five languages**: English, Hindi, Gujarati, Tamil, Telugu
- **RAG-powered research explanations** grounded in cited primary literature, not generic AI summaries
- **Cooking method modifiers** — pressure cooking, cooling/reheating (resistant starch), sprouting, and other methods that measurably change glycemic impact
- **Voice meal logging** in all five supported languages
- **Barcode scanning** with a community contribution pipeline for products not yet in the database

## Scoring Methodology

### Rule-based meal scores

**Diabetes score** — glycemic load (continuous piecewise function, not a hard GI cutoff), refined carbohydrate share with a legume/vegetable carve-out, fiber content, and protein quality. An India context multiplier applies population-specific thresholds derived from ICMR-INDIAB.

**Cardiovascular score** — saturated fat (with a partial exemption for dairy fat, which behaves differently than other saturated fat sources in South Asian cohort data), MUFA:SFA ratio, fiber, and sodium. The US context is calibrated against MASALA Study data on South Asian cardiovascular risk.

**Hypertension score** — sodium, potassium (protective factor), saturated fat, and added sugar.

### ML personal risk context panel

A gradient-boosted machine (GBM) model trained on NHANES 2011–2018, using age, BMI, waist circumference, sedentary hours, and seven dietary features to estimate personal baseline diabetes and cardiovascular risk. This panel is **separate from meal scoring** — it reflects a person's underlying risk profile, not the risk of any individual meal, and the two should not be conflated when reading results.

## Data Sources

- **INDB / ICMR** — Indian food composition data
- **Augustin et al. (2021)**, International Tables of Glycemic Index and Glycemic Load
- **ICMR-INDIAB** (Anjana et al., 2017) — India-specific diabetes risk thresholds
- **MASALA Study** (Kanaya & Kandula, UCSF) — US South Asian cardiovascular risk data
- **NHANES 2011–2018** — ML model training data
- **Open Food Facts** — packaged product nutrition data

## NHANES Validation Results

| Model | Test AUC | Asian Subsample AUC |
|---|---|---|
| Diabetes | 0.780 | 0.871 |
| Cardiovascular | 0.674 | 0.781 |

Evaluation criteria: correct directionality of effect, correct feature-level directionality, and an Asian-subsample AUC ≥ 0.70.

Note: Spearman correlation between the ML model and the rule-based scorer was not computed — the two measure different constructs (population-level baseline risk vs. single-meal quality) and are not expected to correlate.

## Architecture

- **Frontend** — vanilla JavaScript, no build step, deployed on GitHub Pages
- **Backend** — FastAPI on Render, serving RAG explanations and AI overviews
- **Database** — Supabase (meal history, user auth, ingredient contributions)
- **Embeddings** — Voyage AI `voyage-3-lite`
- **ML inference** — GBM weights exported as JSON, inference runs client-side in the browser

## Limitations

- GI values are population averages; individual glycemic responses vary substantially
- Single-meal scoring does not capture dietary patterns over time
- The ML model is trained on a US population and may not generalize to India
- Hepatic fat, an independent risk predictor in South Asians, cannot be assessed from diet data alone
- **This is not a clinical instrument.** It is educational only and does not substitute for medical advice.

## Research Collaboration

Contact: [obbhatt24@gmail.com](mailto:obbhatt24@gmail.com)

I'm interested in research collaboration, particularly around:

- South Asian dietary cohort data for model validation
- CGM–diet correlation studies in South Asian Type 1 Diabetes populations
- Publication of the scoring methodology

## Citation

If you use this tool in research, please cite:

> Bhatt O. (2026). *South Asian Diet Disease-Risk Calculator* [Software]. GitHub. https://github.com/obbhatt24-sudo/South-asian-diet-risk

## License

MIT License — open source, free to use and modify with attribution.
