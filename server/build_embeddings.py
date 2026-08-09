"""One-time script: embed all corpus chunks and write data/embeddings.json.

Run from the server/ directory:  python build_embeddings.py
"""

import json
import os
import time

from dotenv import load_dotenv

load_dotenv()

from retriever import EMBED_MODEL, _get_voyage_client

with open(os.environ.get('CORPUS_PATH', '../data/corpus.json'), encoding='utf-8') as f:
    corpus = json.load(f)

# The free Voyage tier without a payment method is limited to 3 requests/minute
# and 10K tokens/minute. The corpus is now large enough that one batch request
# exceeds the token-per-minute cap, so embed in paced sub-batches: each batch
# stays well under 10K tokens, and we sleep ~21s between requests to respect the
# 3 RPM limit. Override with EMBED_BATCH_SIZE / EMBED_BATCH_SLEEP if the key has
# higher limits (a paid key can set EMBED_BATCH_SLEEP=0).
BATCH_SIZE = int(os.environ.get('EMBED_BATCH_SIZE', 25))
BATCH_SLEEP = float(os.environ.get('EMBED_BATCH_SLEEP', 21))

client = _get_voyage_client()
embeddings = []
batches = [corpus[i:i + BATCH_SIZE] for i in range(0, len(corpus), BATCH_SIZE)]
print(f'Embedding {len(corpus)} chunks in {len(batches)} batch(es) of up to {BATCH_SIZE}...')
for b, batch in enumerate(batches):
    if b > 0 and BATCH_SLEEP:
        time.sleep(BATCH_SLEEP)  # stay under the free-tier 3 RPM limit
    result = client.embed([chunk['text'] for chunk in batch], model=EMBED_MODEL)
    for chunk, vec in zip(batch, result.embeddings):
        embeddings.append({
            'id': chunk['id'],
            'source': chunk['source'],
            'full_citation': chunk['full_citation'],
            'relevance_tags': chunk['relevance_tags'],
            'text': chunk['text'],
            'embedding': vec,
        })
    print(f'Batch {b + 1}/{len(batches)} done ({len(embeddings)}/{len(corpus)} chunks embedded)')

out_path = os.environ.get('EMBEDDINGS_PATH', '../data/embeddings.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(embeddings, f)
print(f'Wrote {len(embeddings)} embeddings to {out_path}')
