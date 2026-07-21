import json
import os

import numpy as np
import voyageai

# The Anthropic API has no dedicated embeddings endpoint; Anthropic points to
# Voyage AI for embeddings. voyage-3-lite is free for the first 50M tokens,
# which is far more than this 29-chunk corpus needs.
EMBED_MODEL = 'voyage-3-lite'

_voyage_client = None


def _get_voyage_client() -> voyageai.Client:
    global _voyage_client
    if _voyage_client is None:
        # Reads VOYAGE_API_KEY from the environment if api_key is not passed
        _voyage_client = voyageai.Client(api_key=os.environ.get('VOYAGE_API_KEY'))
    return _voyage_client


def embed_text(text: str) -> list[float]:
    result = _get_voyage_client().embed([text], model=EMBED_MODEL)
    return result.embeddings[0]


def cosine_similarity(a: list, b: list) -> float:
    a, b = np.array(a), np.array(b)
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))


def load_embeddings(path: str) -> list[dict]:
    with open(path) as f:
        return json.load(f)


def retrieve(query: str, embeddings: list[dict], top_k: int = 5) -> list[dict]:
    query_vec = embed_text(query)
    scored = []
    for item in embeddings:
        score = cosine_similarity(query_vec, item['embedding'])
        scored.append({**item, 'similarity': score})
    scored.sort(key=lambda x: x['similarity'], reverse=True)
    return scored[:top_k]
