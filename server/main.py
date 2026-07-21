import json
import os

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

        chunks = retrieve(query, get_embeddings(), top_k=MAX_CHUNKS)

        context_block = ''.join(
            f'[{c["source"]}]: {c["text"]}' for c in chunks
        )

        system_prompt = '''You are a nutrition research assistant explaining
meal-level dietary risk to a health-conscious South Asian individual.
Use only the research passages provided. Cite sources by name in parentheses.
Do not invent statistics. Do not give medical advice or use alarming language.
Write in plain English, 3-5 sentences. Focus on what the numbers mean
and what the most impactful change would be.'''

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


@app.get('/health')
async def health():
    return {'status': 'ok'}
