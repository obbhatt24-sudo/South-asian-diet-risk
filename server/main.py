import json
import os
import re

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from retriever import load_embeddings, retrieve
from anthropic import Anthropic

app = FastAPI()
claude = Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'])

ALLOWED_ORIGIN = os.environ.get('ALLOWED_ORIGIN', '*')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN, 'http://localhost:8080', 'http://127.0.0.1:5500'],
    allow_methods=['POST'],
    allow_headers=['Content-Type'],
)

EMBEDDINGS_PATH = os.environ.get('EMBEDDINGS_PATH', '../data/embeddings.json')
MAX_CHUNKS = int(os.environ.get('MAX_CHUNKS', 5))
_embeddings = None


def get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = load_embeddings(EMBEDDINGS_PATH)
    return _embeddings


# Appended to the system prompt so the model responds in the user's language.
LANGUAGE_INSTRUCTIONS = {
    'en': 'Respond in English.',
    'hi': 'Respond entirely in Hindi (Devanagari script). Use formal Hindi.',
    'gu': 'Respond entirely in Gujarati (Gujarati script). Use formal Gujarati.',
    'ta': 'Respond entirely in Tamil (Tamil script). Use formal Tamil.',
    'te': 'Respond entirely in Telugu (Telugu script). Use formal Telugu.',
}


class ExplainRequest(BaseModel):
    diabetes_score: int
    diabetes_band: str
    cvd_score: int
    cvd_band: str
    flags: list[str]
    context: str          # 'india' | 'us'
    gl: float
    ref_carb_share: float
    fiber_g: float
    sfa_g: float
    mufa_sfa_ratio: float | None
    top_ingredients: list[str]  # top 3 by weight
    top_recommendation: str | None
    language: str = 'en'
    diabetes_context: str | None = 't2d'  # 't1d' | 't2d' | None (default 't2d')


@app.post('/explain')
async def explain(req: ExplainRequest):
    try:
        # Build a query string from the score data to drive retrieval
        flag_phrases = {
            'high_glycemic_load': 'high glycemic load diabetes South Asian rice',
            'high_refined_carb_share': 'refined carbohydrate diabetes insulin resistance',
            'low_fiber': 'dietary fiber glycemic response diabetes',
            'poor_protein_quality': 'protein quality legume diabetes South Asian',
            'high_saturated_fat': 'saturated fat ghee cardiovascular LDL South Asian',
            'poor_fat_quality': 'MUFA SFA ratio mustard oil cardiovascular South Asian',
            'high_sodium': 'sodium blood pressure cardiovascular South Asian',
        }
        query_parts = [flag_phrases.get(f, f) for f in req.flags[:3]]
        context_phrase = (
            'India diet diabetes risk' if req.context == 'india'
            else 'US South Asian cardiovascular MASALA'
        )
        query = ' '.join(query_parts) + ' ' + context_phrase

        if req.diabetes_context == 't1d':
            # Steer retrieval toward T1D dosing/CGM material, then prefer chunks
            # explicitly tagged 'type1_diabetes': pull a wider pool and re-rank so
            # tagged chunks sort ahead of untagged ones (ties broken by similarity).
            query += ' type 1 diabetes insulin dosing CGM bolus glucose management'
            pool = retrieve(query, get_embeddings(), top_k=MAX_CHUNKS * 3)
            pool.sort(
                key=lambda c: ('type1_diabetes' in c.get('relevance_tags', []),
                               c['similarity']),
                reverse=True,
            )
            chunks = pool[:MAX_CHUNKS]
        else:
            chunks = retrieve(query, get_embeddings(), top_k=MAX_CHUNKS)

        context_block = ''.join(
            f'[{c["source"]}]: {c["text"]}' for c in chunks
        )

        lang_instruction = LANGUAGE_INSTRUCTIONS.get(req.language, 'Respond in English.')
        if req.diabetes_context == 't1d':
            system_prompt = f'''You are a nutrition scientist explaining meal composition
to a person with Type 1 diabetes who uses a CGM and insulin pump.
Focus on: (1) how this meal's glycemic load affects bolus insulin timing,
(2) how fat and protein content causes delayed glucose rise requiring dual-wave
or extended bolus, (3) how fiber content moderates glucose absorption speed.
Do NOT frame this as disease risk reduction — frame it as glucose management
and dosing accuracy. Cite sources. Do not give medical advice.
Use plain English. 3 paragraphs.
{lang_instruction}'''
        else:
            system_prompt = f'''You are a nutrition research assistant explaining
meal-level dietary risk to a health-conscious South Asian individual.
Use only the research passages provided. Cite sources by name in parentheses.
Do not invent statistics. Do not give medical advice or use alarming language.
Write in plain English, 3-5 sentences. Focus on what the numbers mean
and what the most impactful change would be.
{lang_instruction}'''

        user_prompt = f'''
Meal scores:
  Diabetes: {req.diabetes_score}/100 ({req.diabetes_band})
  CVD: {req.cvd_score}/100 ({req.cvd_band})
  Glycemic load: {req.gl:.1f}
  Refined carb share: {req.ref_carb_share*100:.0f}%
  Fiber: {req.fiber_g:.1f}g
  Saturated fat: {req.sfa_g:.1f}g
  MUFA:SFA ratio: {req.mufa_sfa_ratio if req.mufa_sfa_ratio else 'not calculated'}
  Main ingredients: {', '.join(req.top_ingredients)}
  Top recommendation: {req.top_recommendation or 'none'}
  Context: {req.context}
  Active risk flags: {', '.join(req.flags)}

Research passages:
{context_block}

Write a 3-5 sentence explanation of why this meal scored as it did,
citing the sources provided. End with one sentence about the highest-impact
change the user could make, if any recommendation was provided.'''

        response = claude.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=400,
            system=system_prompt,
            messages=[{'role': 'user', 'content': user_prompt}],
        )

        return {
            'explanation': response.content[0].text,
            'chunks_used': [{'id': c['id'], 'source': c['source'],
                             'citation': c['full_citation']} for c in chunks],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class TopicRequest(BaseModel):
    flag: str
    context: str = 'india'  # 'india' | 'us'
    language: str = 'en'
    diabetes_context: str | None = 't2d'  # 't1d' | 't2d' | None (default 't2d')


@app.post('/topic')
async def topic_overview(req: TopicRequest):
    try:
        # Build a retrieval query from the flag
        flag_queries = {
            'high_glycemic_load':      'glycemic load blood sugar South Asian diabetes rice',
            'high_refined_carb_share': 'refined carbohydrates white rice maida insulin resistance diabetes',
            'low_fiber':               'dietary fibre fiber blood sugar cardiovascular South Asian',
            'poor_protein_quality':    'protein quality legume dairy diabetes South Asian',
            'high_saturated_fat':      'saturated fat ghee LDL cholesterol cardiovascular South Asian',
            'poor_fat_quality':        'MUFA SFA ratio mustard oil ghee cardiovascular fat quality',
            'high_sodium':             'sodium blood pressure cardiovascular South Asian salt',
        }
        context_phrase = 'India ICMR-INDIAB' if req.context == 'india' else 'US South Asian MASALA'
        query = flag_queries.get(req.flag, req.flag) + ' ' + context_phrase

        if req.diabetes_context == 't1d':
            query += ' type 1 diabetes insulin dosing CGM'

        chunks = retrieve(query, get_embeddings(), top_k=MAX_CHUNKS)
        context_block = '\n\n'.join(
            f'[{c["source"]}]: {c["text"]}' for c in chunks
        )

        topic_labels = {
            'high_glycemic_load':      'Glycemic Load and Blood Sugar',
            'high_refined_carb_share': 'Refined Carbohydrates and Diabetes Risk',
            'low_fiber':               'Dietary Fibre and Metabolic Health',
            'poor_protein_quality':    'Protein Quality and Diabetes Risk',
            'high_saturated_fat':      'Saturated Fat and Cardiovascular Risk',
            'poor_fat_quality':        'Fat Quality: MUFA vs SFA in South Asian Diets',
            'high_sodium':             'Sodium Intake and Blood Pressure',
        }
        topic_label = topic_labels.get(req.flag, req.flag)

        lang_instruction = LANGUAGE_INSTRUCTIONS.get(req.language, 'Respond in English.')
        system_prompt = f'''You are a nutrition scientist writing an accessible
educational overview for a health-conscious South Asian audience.
Write 3-4 paragraphs covering: (1) what this risk factor is and how it works
biologically, (2) why South Asians are specifically affected, (3) what the
research evidence says about dietary modification, and (4) practical implications.
Cite sources by name in parentheses. Do not give medical advice.
Use plain English. Avoid jargon without explanation.
{lang_instruction}'''

        user_prompt = f'''Topic: {topic_label}
Context: {req.context} South Asian population

Research passages:
{context_block}

Write a 3-4 paragraph educational overview of this topic for
South Asian individuals interested in their dietary health.
Cite the provided sources. Do not reproduce full sentences from the sources.
End with one practical takeaway sentence.'''

        response = claude.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=600,
            system=system_prompt,
            messages=[{'role': 'user', 'content': user_prompt}]
        )

        return {
            'overview': response.content[0].text,
            'chunks_used': [{'id': c['id'], 'source': c['source'],
                             'citation': c['full_citation']} for c in chunks]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class IngredientAnalysisRequest(BaseModel):
    product_name: str
    ingredients_text: str
    red_flags: list[str]    # short names of red-flagged ingredients
    amber_flags: list[str]  # short names of amber-flagged ingredients
    nutriscore: str | None
    nova_group: int | None
    context: str = 'india'
    language: str = 'en'


@app.post('/ingredient-analysis')
async def ingredient_analysis(req: IngredientAnalysisRequest):
    try:
        # Build retrieval query from the flagged ingredients
        query_parts = []
        for flag in req.red_flags[:3]:
            if 'refined' in flag.lower() or 'maida' in flag.lower():
                query_parts.append('refined wheat flour glycemic index diabetes South Asian')
            elif 'palm oil' in flag.lower() or 'hydrogenated' in flag.lower():
                query_parts.append('palm oil saturated fat cardiovascular LDL South Asian')
            elif 'sugar' in flag.lower():
                query_parts.append('added sugar glycemic load insulin resistance South Asian')
        for flag in req.amber_flags[:2]:
            if 'sodium' in flag.lower() or 'salt' in flag.lower():
                query_parts.append('sodium blood pressure South Asian salt sensitivity')
        if not query_parts:
            query_parts = ['packaged food processing cardiovascular diabetes risk']

        context_phrase = 'India ICMR-INDIAB' if req.context == 'india' else 'US South Asian MASALA'
        query = ' '.join(query_parts) + ' ' + context_phrase

        chunks = retrieve(query, get_embeddings(), top_k=MAX_CHUNKS)
        context_block = '\n\n'.join(
            f'[{c["source"]}]: {c["text"]}' for c in chunks
        )

        lang_instruction = LANGUAGE_INSTRUCTIONS.get(req.language, 'Respond in English.')

        system_prompt = f'''You are a nutrition scientist analysing
packaged food ingredients for a South Asian audience concerned about
diabetes and cardiovascular disease risk.
Use only the research passages provided. Cite sources by name.
Do not give medical advice. Be specific about which ingredients
are most concerning and why, given South Asian metabolic risk patterns.
Write 3-4 paragraphs. {lang_instruction}'''

        nova_text = f'NOVA group {req.nova_group} (ultra-processed)' if req.nova_group == 4 else ''
        user_prompt = f'''
Product: {req.product_name}
Nutri-Score: {req.nutriscore or 'not available'}  {nova_text}
Ingredients: {req.ingredients_text[:500]}
High-risk ingredients identified: {', '.join(req.red_flags) or 'none'}
Moderate-concern ingredients: {', '.join(req.amber_flags) or 'none'}
Context: {req.context} South Asian population

Research passages:
{context_block}

Explain in 3-4 paragraphs how this product's specific ingredient
combination affects South Asian diabetes and CVD risk.
Focus on the high-risk ingredients and their cumulative effect.
End with one practical recommendation.'''

        response = claude.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=600,
            system=system_prompt,
            messages=[{'role': 'user', 'content': user_prompt}]
        )

        return {
            'analysis': response.content[0].text,
            'chunks_used': [{'id': c['id'], 'source': c['source'],
                             'citation': c['full_citation']} for c in chunks]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ParseMealRequest(BaseModel):
    transcript: str
    ingredient_names: list[str] = []  # local ingredient DB names, for matching
    language: str = 'en'


@app.post('/parse-meal')
async def parse_meal(req: ParseMealRequest):
    """Parse a spoken meal description into structured ingredient items.

    Runs the LLM call server-side so the Anthropic API key stays secret —
    the browser cannot call api.anthropic.com directly. Returns a JSON
    array the frontend feeds straight into applyVoiceMealItems().
    """
    try:
        ingredient_list = ', '.join(req.ingredient_names[:100])
        system_prompt = f'''You are a nutrition assistant helping parse
a spoken meal description into structured ingredients.
Respond ONLY with a JSON array. No other text.
Each item: {{ "name": string, "grams": number, "cooking_method": string|null }}
Use only ingredient names from this list where possible: {ingredient_list}
For cooking_method, use one of: boiled, pressure_cooked, steamed,
deep_fried, shallow_fried, roasted_dry, cooled_reheated, fermented,
sprouted, raw, tadka, or null if not specified.
The meal may be described in a language other than English; still return
ingredient names drawn from the (English) list above where they match.
Estimate grams from common serving descriptions:
  1 cup cooked rice = 180g
  1 roti/chapati = 40g
  1 small bowl dal = 150g
  1 medium bowl sabzi = 120g
  1 serving = use typical South Asian serving size
If a quantity is not mentioned, estimate a typical single serving.'''

        response = claude.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=500,
            system=system_prompt,
            messages=[{'role': 'user',
                       'content': f'Parse this meal: "{req.transcript}"'}],
        )

        text = response.content[0].text.strip()
        clean = text.replace('```json', '').replace('```', '').strip()
        items = json.loads(clean)
        if not isinstance(items, list):
            items = []
        return {'items': items}
    except json.JSONDecodeError:
        raise HTTPException(status_code=502,
                            detail='Could not parse meal into structured items')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ParseCookingRequest(BaseModel):
    transcript: str
    ingredient_names: list[str] = []  # names of ingredients currently in the meal
    method_ids: list[str] = []        # available cooking-method ids (id + name)
    language: str = 'en'


# Fallback set if the client sends no method_ids — matches data/cooking-methods.json
DEFAULT_METHOD_IDS = [
    'boiled', 'pressure_cooked', 'steamed', 'deep_fried', 'shallow_fried',
    'roasted_dry', 'cooled_reheated', 'fermented', 'sprouted', 'raw', 'tadka',
]


@app.post('/parse-cooking-methods')
async def parse_cooking_methods(req: ParseCookingRequest):
    """Parse a spoken description of how food was cooked into per-ingredient
    cooking-method assignments.

    Runs the LLM call server-side so the Anthropic API key stays secret —
    the browser cannot call api.anthropic.com directly. Returns a JSON array
    of { ingredient_name, method_id } the frontend maps onto its meal items.
    """
    try:
        ingredient_list = ', '.join(req.ingredient_names[:100])
        method_list = ', '.join(req.method_ids) if req.method_ids \
            else ', '.join(DEFAULT_METHOD_IDS)
        system_prompt = f'''You are parsing a description of cooking methods.
Respond ONLY with a JSON array. No other text.
Each item: {{ "ingredient_name": string, "method_id": string }}
Available method IDs: {method_list}
Match ingredient names to this list: {ingredient_list}
The description may be in a language other than English; still return
ingredient names drawn from the (English) list above where they match.
Only include an item when the description clearly states how that
ingredient was cooked.'''

        response = claude.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=300,
            system=system_prompt,
            messages=[{'role': 'user',
                       'content': f'Cooking description: "{req.transcript}"'}],
        )

        text = response.content[0].text.strip()
        clean = text.replace('```json', '').replace('```', '').strip()
        assignments = json.loads(clean)
        if not isinstance(assignments, list):
            assignments = []
        return {'assignments': assignments}
    except json.JSONDecodeError:
        raise HTTPException(status_code=502,
                            detail='Could not parse cooking methods')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class DisambiguateRequest(BaseModel):
    terms: list[str]
    ingredient_names: list[str] = []


@app.post('/disambiguate-ingredients')
async def disambiguate_ingredients(req: DisambiguateRequest):
    """Match spoken ingredient terms that survived the local exact/synonym/
    fuzzy layers in js/voice-matching.js to the closest known ingredient name.

    Runs the LLM call server-side so the Anthropic API key stays secret —
    the browser cannot call api.anthropic.com directly (see /parse-meal).
    """
    try:
        if not req.terms:
            return {'matches': []}
        ingredient_list = ', '.join(req.ingredient_names[:80])
        system_prompt = f'''Match these spoken food terms to the closest
ingredient name. Respond ONLY with a JSON array. No other text.
Each item: {{ "spoken": string, "matched_name": string|null, "confidence": "high"|"medium"|"low" }}
Set matched_name to null if no reasonable match exists.
Available ingredients: {ingredient_list}'''

        response = claude.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=400,
            system=system_prompt,
            messages=[{'role': 'user',
                       'content': f'Terms to match: {json.dumps(req.terms)}'}],
        )

        text = response.content[0].text.strip()
        clean = text.replace('```json', '').replace('```', '').strip()
        matches = json.loads(clean)
        if not isinstance(matches, list):
            matches = []
        return {'matches': matches}
    except json.JSONDecodeError:
        raise HTTPException(status_code=502,
                            detail='Could not disambiguate ingredient terms')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _strip_markdown(text: str) -> str:
    """Strip common markdown syntax the model adds despite instructions
    not to, since the frontend renders this text as raw innerHTML."""
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'(?<!\w)\*(.+?)\*(?!\w)', r'\1', text)
    text = re.sub(r'^[\s]*[-*]\s+', '', text, flags=re.MULTILINE)
    return text.strip()


class MonthlySummaryRequest(BaseModel):
    meal_count: int
    avg_diabetes_score: int
    avg_cvd_score: int
    top_flags: list[str] = []
    recent_meal_names: list[str] = []
    language: str = 'en'


@app.post('/monthly-summary')
async def monthly_summary(req: MonthlySummaryRequest):
    """Summarise a month of saved meal history into a personalised
    dietary summary.

    Runs the LLM call server-side so the Anthropic API key stays secret —
    the browser cannot call api.anthropic.com directly.
    """
    try:
        lang_instruction = LANGUAGE_INSTRUCTIONS.get(req.language, 'Respond in English.')

        system_prompt = f'''You are a South Asian nutrition advisor reviewing
a month of meal history for one person.
Output raw plain text ONLY — never use markdown syntax of any kind.
Specifically: no "#" headers, no "**" bold, no "*" or "-" bullet
points, no numbered lists. Write ordinary prose sentences only.
Write exactly 3 paragraphs, separated by a single blank line:
Paragraph 1: What the scores and patterns show overall.
Paragraph 2: The 1-2 most consistent dietary risk factors and their
  specific impact on South Asian metabolic health.
Paragraph 3: 2-3 specific, achievable dietary changes for next month.
Keep each paragraph to 3-4 sentences so the whole summary is concise.
Be direct, warm, and specific. Do not give medical advice.
Do not mention that you are an AI. {lang_instruction}'''

        user_prompt = f'''Summary data:
- Meals saved: {req.meal_count}
- Average diabetes score: {req.avg_diabetes_score}/100
- Average CVD score: {req.avg_cvd_score}/100
- Most common risk flags: {'; '.join(req.top_flags) or 'none'}
- Recent meals include: {', '.join(req.recent_meal_names) or 'none'}'''

        response = claude.messages.create(
            model='claude-sonnet-4-6',
            max_tokens=900,
            system=system_prompt,
            messages=[{'role': 'user', 'content': user_prompt}]
        )

        return {'summary': _strip_markdown(response.content[0].text)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/health')
async def health():
    return {'status': 'ok'}
