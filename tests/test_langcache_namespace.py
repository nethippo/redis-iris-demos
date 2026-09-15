import json

import httpx
import pytest

from backend.app.langcache_service import LangCacheService
from backend.app.settings import Settings


@pytest.mark.asyncio
@pytest.mark.parametrize("prompt", [
    "What accounts do I have and what are my current balances?",
    "What are my FD interest rates?",
    "Show balance for CUST001",
    "Place 2000 in FD6 at the current interest rate",
])
async def test_personal_banking_queries_never_use_public_faq_cache(prompt):
    service = LangCacheService(Settings(
        demo_domain="radish-bank", langcache_host="https://cache.example",
        langcache_cache_id="demo", langcache_api_key="test",
    ))
    def unexpected(request):
        pytest.fail("Personal banking request reached shared FAQ cache")
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(unexpected))
    try:
        assert await service.search(prompt) is None
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_shared_cache_rejects_other_domain_and_strips_own_prefix():
    results = [
        [{"prompt": "Sports FAQ", "response": "sports", "similarity": 1}],
        [{"prompt": "[radish-bank] FD rates", "response": "bank", "similarity": 1}],
    ]

    def respond(request):
        assert json.loads(request.content)["prompt"] == "[radish-bank] FD rates"
        return httpx.Response(200, json={"data": results.pop(0)})

    service = LangCacheService(Settings(
        langcache_host="https://cache.example", langcache_cache_id="demo",
        langcache_api_key="test", langcache_namespace="radish-bank",
    ))
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    try:
        assert await service.search("FD rates") is None
        result = await service.search("FD rates")
        assert result["response"] == "bank"
        assert result["prompt"] == "FD rates"
    finally:
        await service.close()


@pytest.mark.asyncio
async def test_attribute_fallback_keeps_namespace_exactly_once():
    calls = []

    def respond(request):
        body = json.loads(request.content)
        calls.append(body)
        if "attributes" in body:
            return httpx.Response(400, text="no attributes are configured")
        return httpx.Response(200, json={"id": "test"})

    service = LangCacheService(Settings(
        langcache_host="https://cache.example", langcache_cache_id="demo",
        langcache_api_key="test", langcache_namespace="radish-bank",
    ))
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    try:
        assert await service.store("FD rates", "bank", {"domain": "radish-bank"})
        assert len(calls) == 2
        assert all(c["prompt"] == "[radish-bank] FD rates" for c in calls)
    finally:
        await service.close()
