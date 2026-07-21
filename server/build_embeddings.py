"""One-time script: embed all corpus chunks and write data/embeddings.json.

Run from the server/ directory:  python build_embeddings.py
"""

import json
import os

from dotenv import load_dotenv

load_dotenv()

from retriever import embed_text

with open(os.environ.get('CORPUS_PATH', '../data/corpus.json')) as f:
    corpus = json.load(f)

embeddings = []
for i, chunk in enumerate(corpus):
    print(f'Embedding chunk {i + 1}/{len(corpus)}: {chunk["id"]}')
    vec = embed_text(chunk['text'])
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
