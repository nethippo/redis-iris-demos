"""Read-only, real-embedding evaluation; never initializes or overwrites a router.

Run inside the backend image with .env.radish, repo mounted at /work and a
private output directory at /results. See docker/README.ko.md for usage.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from openai import AsyncOpenAI
from backend.app.settings import get_settings
from backend.app.core.domain_loader import load_domain

async def evaluate(args):
    settings = get_settings()
    config = json.loads(Path(args.config).read_text()) if args.config else load_domain('radish-bank').manifest.guardrail.model_dump()
    cases = json.loads(Path(args.cases).read_text())
    if args.split != 'all': cases = [c for c in cases if c['split'] == args.split]
    cache_path = Path(args.cache)
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    def key(text): return hashlib.sha256((settings.openai_embedding_model+'\0'+text).encode()).hexdigest()
    refs = [(r['name'], float(r['distance_threshold']), text) for r in config['routes'] for text in r['references']]
    texts = list(dict.fromkeys([r[2] for r in refs]+[c['text'] for c in cases]))
    missing = [t for t in texts if key(t) not in cache]
    async with AsyncOpenAI(api_key=settings.openai_api_key) as client:
        for offset in range(0,len(missing),64):
            batch = missing[offset:offset+64]
            result = await client.embeddings.create(model=settings.openai_embedding_model,input=batch)
            for item in result.data: cache[key(batch[item.index])] = item.embedding
            cache_path.parent.mkdir(parents=True,exist_ok=True)
            cache_path.write_text(json.dumps(cache))
    redis_client = None
    if args.redis:
        from backend.app.redis_connection import create_redis_client
        from redis.commands.search.query import Query
        redis_client = create_redis_client(settings)
    matrix = np.array([cache[key(t)] for _,_,t in refs],dtype=np.float32)
    matrix /= np.linalg.norm(matrix,axis=1,keepdims=True)
    results=[]
    max_distance_delta = 0.0
    decision_disagreements = 0
    for c in cases:
        v=np.array(cache[key(c['text'])],dtype=np.float32);v/=np.linalg.norm(v)
        distances=1-matrix@v
        route_distances={r['name']:float(min(distances[i] for i,ref in enumerate(refs) if ref[0]==r['name'])) for r in config['routes']}
        def classify(scores):
            eligible = [(distance, name) for name, distance in scores.items()
                        if distance < next(r['distance_threshold'] for r in config['routes'] if r['name'] == name)]
            return min(eligible) if eligible else (None, None)
        offline_best = classify(route_distances)
        redis_distances = None
        if redis_client is not None:
            redis_distances = {}
            for name, expected in route_distances.items():
                query = Query(f"(@route_name:{{{name}}})=>[KNN 1 @vector $v AS distance]").return_fields('distance').sort_by('distance').dialect(2)
                docs = redis_client.ft(config['router_name']).search(query, query_params={'v': v.tobytes()}).docs
                if not docs:
                    raise RuntimeError(f"Redis route has no references: {name}")
                redis_distances[name] = float(docs[0].distance)
                max_distance_delta = max(max_distance_delta, abs(redis_distances[name] - expected))
        best = classify(redis_distances) if redis_distances is not None else offline_best
        decision_disagreements += best[1] != offline_best[1]
        results.append({**c, 'route': best[1], 'distance': best[0],
                        'route_distances': route_distances, 'redis_distances': redis_distances,
                        'allowed': best[1] == config['allowed_route_name']})
    metrics={}
    for split in sorted({r['split'] for r in results}):
        subset=[r for r in results if r['split']==split]
        positive=[r for r in subset if r['expected']=='banking'];negative=[r for r in subset if r['expected']=='blocked']
        metrics[split]={'banking_total':len(positive),'banking_allowed':sum(r['allowed'] for r in positive),'off_topic_total':len(negative),'off_topic_allowed':sum(r['allowed'] for r in negative),'by_language':{}}
        for lang in ['ko','en','mixed']:
            rs=[r for r in positive if r['language']==lang]
            metrics[split]['by_language'][lang]={'total':len(rs),'allowed':sum(r['allowed'] for r in rs)}
    if redis_client is not None: redis_client.close()
    report={'redis_verified':args.redis,'max_distance_delta':max_distance_delta,'decision_disagreements':decision_disagreements,'model':settings.openai_embedding_model,'aggregation':'min','config':config,'metrics':metrics,'results':results}
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(metrics,ensure_ascii=False))
    if args.redis:
        print(json.dumps({'max_distance_delta':max_distance_delta,'decision_disagreements':decision_disagreements}))
    if args.check:
        assert decision_disagreements == 0, 'Redis and offline decisions disagree'
        m=metrics['validation'];ko=m['by_language']['ko']
        assert m['banking_allowed']/m['banking_total']>=.95 and ko['allowed']/ko['total']>=.95 and m['off_topic_allowed']==0,'Validation targets not met'

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--redis',action='store_true',help='Verify every distance against the existing Redis index, read-only');p.add_argument('--config');p.add_argument('--cases',default=str(Path(__file__).resolve().parents[1]/'tests/fixtures/radish_guardrail_cases.json'))
    p.add_argument('--split',choices=['development','validation','context','all'],default='development')
    p.add_argument('--cache',required=True);p.add_argument('--output',required=True);p.add_argument('--check',action='store_true')
    asyncio.run(evaluate(p.parse_args()))
