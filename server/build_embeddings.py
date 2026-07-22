"""One-time script: embed all corpus chunks and write data/embeddings.json.

Run from the server/ directory:  python build_embeddings.py
"""

import json
import os

from dotenv import load_dotenv

load_dotenv()

from retriever import EMBED_MODEL, _get_voyage_client

with open(os.environ.get('CORPUS_PATH', '../data/corpus.json')) as f:
    corpus = json.load(f)

# One batched request for the whole corpus: the free tier without a payment
# method is limited to 3 requests/minute, so per-chunk requests get throttled.
print(f'Embedding {len(corpus)} chunks in one batch request...')
result = _get_voyage_client().embed([chunk['text'] for chunk in corpus], model=EMBED_MODEL)

embeddings = []
for i, (chunk, vec) in enumerate(zip(corpus, result.embeddings)):
    print(f'Embedded chunk {i + 1}/{len(corpus)}: {chunk["id"]}')
    embeddings.append({
        'id': chunk['id'],
        'source': chunk['source'],
        'full_citation': chunk['full_citation'],
        'relevance_tags': chunk['relevance_tags'],
        'text': chunk['text'],
        'embedding': vec,
    })

out_path = os.environ.get('EMBEDDINGS_PATH', '../data/embeddings.json')
with open(out_path, 'w') as f:
    json.dump(embeddings, f)
print(f'Wrote {len(embeddings)} embeddings to {out_path}')
