"""Initialize a demo without flushing shared Redis, Memory, or LangCache."""
from __future__ import annotations

import asyncio
import argparse
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from backend.app.core.domain_loader import get_active_domain
from backend.app.langcache_service import LangCacheService
from backend.app.memory_service import MemoryService
from backend.app.redis_connection import create_redis_client
from backend.app.settings import get_settings


def run_script(name: str) -> None:
    load_dotenv(ROOT / ".env", override=True)
    subprocess.run([sys.executable, f"scripts/{name}.py", "--domain", get_settings().demo_domain], check=True)


async def seed_services() -> None:
    settings = get_settings()
    domain = get_active_domain(settings)
    memory = MemoryService(settings)
    if memory.is_configured():
        for i, entry in enumerate(domain.manifest.seed_memories):
            memory.create_long_term_memory(
                text=entry.text,
                owner_id=os.getenv("DEMO_USER_ID") or domain.manifest.identity.default_id,
                memory_type=entry.memory_type,
                topics=entry.topics,
                memory_id=f"seed-{settings.demo_domain}-{i}",
            )
        print(f"Agent Memory: seeded {len(domain.manifest.seed_memories)} demo memories; existing records preserved")
    cache = LangCacheService(settings)
    try:
        if cache.is_configured():
            for entry in domain.manifest.seed_langcache:
                if not await cache.search(entry.prompt):
                    if not await cache.store(entry.prompt, entry.response, entry.attributes or None):
                        raise RuntimeError("LangCache seed failed")
            print("LangCache: demo entry ready; existing cache preserved")
    finally:
        await cache.close()
        await memory.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--structured-only", action="store_true", help="Load 8 structured entities while OpenAI policy embeddings are unavailable")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env", override=True)
    settings = get_settings()
    if settings.demo_domain not in {"sports-betting", "radish-bank"}:
        raise SystemExit("Docker setup supports sports-betting and radish-bank")
    if args.structured_only and settings.demo_domain != "sports-betting":
        raise SystemExit("--structured-only is supported only for sports-betting")
    if not args.structured_only and not settings.openai_api_key:
        raise SystemExit("OPENAI_API_KEY is required for real policy embeddings")
    redis = create_redis_client(settings)
    print(f"Redis: ping={redis.ping()}, existing_keys={redis.dbsize()}")
    redis.close()
    run_script("generate_models")
    if settings.ctx_admin_key:
        run_script("setup_surface")
        load_dotenv(ROOT / ".env", override=True)
    if args.structured_only:
        domain = get_active_domain(get_settings())
        generator = importlib.import_module("domains.sports-betting.data_generator")
        output = ROOT / domain.manifest.output_dir
        output.mkdir(parents=True, exist_ok=True)
        for spec in domain.get_entity_specs():
            rows = [] if spec.class_name == "Policy" else getattr(generator, Path(spec.file_name).stem.upper())
            (output / spec.file_name).write_text("".join(json.dumps(row) + "\n" for row in rows))
        print("Structured-only bootstrap: policy embeddings and policy records are PENDING")
    else:
        run_script("generate_data")
    if settings.ctx_admin_key:
        run_script("load_data")
    else:
        print("Context Retriever pending: set CTX_ADMIN_KEY in .env and rerun setup")
    asyncio.run(seed_services())


if __name__ == "__main__":
    main()
