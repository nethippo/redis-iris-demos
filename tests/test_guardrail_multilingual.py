"""Routing decisions, localization and early exits; no network calls."""
import asyncio
import json
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault('OPENAI_API_KEY', 'test-key')
import pytest
from backend.app.core.domain_loader import load_domain
from backend.app.guardrail_service import GuardrailService
from backend.app.settings import Settings


def service(domain='radish-bank'):
    return GuardrailService(Settings(_env_file=None, openai_api_key='test-key'), load_domain(domain).manifest.guardrail)


@pytest.mark.parametrize('name,distance,allowed,reason', [
    ('banking', .32, True, 'allowed'), ('off_topic', .41, False, 'off_topic'), (None, None, False, 'no_match'),
])
def test_match_outcomes(monkeypatch, name, distance, allowed, reason):
    svc = service()
    monkeypatch.setattr(svc, '_ensure_router', AsyncMock(return_value=lambda *_: SimpleNamespace(name=name, distance=distance)))
    result = asyncio.run(svc.check([.1,.2]))
    assert (result['allowed'], result['reason'], result['distance']) == (allowed, reason, distance)


@pytest.mark.parametrize('text,reason,fragment', [
    ('이거요', 'no_match', '조금 더 자세히'),
    ('What about that?', 'no_match', 'Please describe'),
    ('은행 코드 만들어줘', 'off_topic', '은행 업무'),
    ('Write code', 'off_topic', 'I can help'),
])
def test_localization_does_not_change_decision(text, reason, fragment):
    result = {'allowed': False, 'reason': reason, 'route': None, 'distance': None}
    original = result.copy()
    assert fragment in service().rejection_message(text, result)
    assert result == original
    assert service().rejection_message(text, {'allowed': True}) is None


def test_other_domains_keep_their_own_copy():
    svc = service('sports-betting')
    assert svc._config.rejection_messages == {}
    assert svc.rejection_message('한글', {'allowed': False, 'reason': 'no_match'}) is None
    assert svc.rejection_message('한글', {'allowed': False, 'reason': 'off_topic', 'block_message': 'original'}) == 'original'


def test_service_exception_policy_is_unchanged(monkeypatch):
    svc = service()
    monkeypatch.setattr(svc, '_ensure_router', AsyncMock(side_effect=RuntimeError('unavailable')))
    assert asyncio.run(svc.check([.1]))['allowed'] is True


@pytest.mark.parametrize('mode', ['context_surfaces', 'simple_rag'])
@pytest.mark.parametrize('reason,route,distance', [('no_match',None,None),('off_topic','off_topic',.3)])
def test_rejected_stream_ends_before_downstream_services(monkeypatch, mode, reason, route, distance, caplog):
    import backend.app.main as main
    from backend.app.contracts import ChatRequest
    svc = service()
    monkeypatch.setattr(main, 'guardrail_service', svc)
    monkeypatch.setattr(svc, 'is_configured', lambda: True)
    monkeypatch.setattr(svc, 'embed', AsyncMock(return_value=[.1,.2]))
    monkeypatch.setattr(svc, 'check', AsyncMock(return_value={'allowed':False,'reason':reason,'route':route,'distance':distance}))
    def forbidden(*_args, **_kwargs):
        pytest.fail('Rejected request reached a downstream service')
    monkeypatch.setattr(main.langcache_service, 'is_configured', forbidden)
    monkeypatch.setattr(main.memory_service, 'is_configured', forbidden)
    monkeypatch.setattr(main, 'get_agent', forbidden)
    monkeypatch.setattr(main.rag_service, 'stream_answer', forbidden)
    async def collect():
        stream = main.cs_event_stream(ChatRequest(messages=[{'role':'user','content':'이 질문을 확인해주세요'}],thread_id='test-guardrail',mode=mode)) if mode=='context_surfaces' else main.rag_event_stream('이 질문을 확인해주세요')
        return [json.loads(chunk.removeprefix('data: ').split('\n\n')[0]) async for chunk in stream]
    events=asyncio.run(collect())
    decision=next(e['payload'] for e in events if e['type']=='tool-result')
    assert decision['reason']==reason and decision['distance']==distance
    assert events[-1]['guardrailBlocked'] is True and events[-1]['guardrailReason']==reason
    answer=''.join(e.get('delta','') for e in events if e['type']=='text-delta')
    assert ('조금 더 자세히' if reason=='no_match' else '은행 업무') in answer
    assert all(e.get('toolName') in (None,'guardrail_check') for e in events)


def test_other_domains_keep_legacy_decision_metadata(monkeypatch):
    svc = service('sports-betting')
    monkeypatch.setattr(svc, '_ensure_router', AsyncMock(return_value=lambda *_: SimpleNamespace(name=None, distance=None)))
    assert asyncio.run(svc.check([.1])) == {'allowed': False, 'route': None, 'distance': None, 'block_message': None}
