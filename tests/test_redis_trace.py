import asyncio
import json

import pytest
from langgraph.checkpoint.redis.aio import AsyncRedisSaver

from backend.app.redis_trace import TracedRedisSaver, stream_with_redis_events, trace_redis


async def collect(source):
    return [item async for item in stream_with_redis_events(source, lambda event: event)]


@pytest.mark.parametrize("method,label", [
    ("aget_tuple", "Read checkpoint"),
    ("aput", "Write checkpoint"),
    ("aput_writes", "Write checkpoint updates"),
])
def test_saver_reports_actual_parent_call_and_preserves_return(monkeypatch, method, label):
    received = []

    async def parent(self, *args, **kwargs):
        received.append((args, kwargs))
        return "private result"

    monkeypatch.setattr(AsyncRedisSaver, method, parent)
    saver = object.__new__(TracedRedisSaver)

    async def source():
        result = await getattr(saver, method)("private config", extra="private value")
        assert result == "private result"
        yield "finished"

    events = asyncio.run(collect(source))
    assert received == [(("private config",), {"extra": "private value"})]
    start, end, chunk = events
    assert start["phase"] == "start" and end["phase"] == "end"
    assert start["id"] == end["id"]
    assert start["from"] == "agent" and start["to"] == "redis"
    assert end["label"] == label and end["durationMs"] >= 0
    assert chunk == "finished"
    assert "private" not in json.dumps(events)


def test_failure_preserves_exception_and_never_emits_success():
    async def source():
        try:
            async with trace_redis("router", "Route vector search"):
                raise ValueError("private Redis error")
        except ValueError:
            yield "fallback"

    events = asyncio.run(collect(source))
    assert [e["phase"] for e in events if isinstance(e, dict)] == ["start", "error"]
    assert "private" not in json.dumps(events)


def test_concurrent_requests_do_not_mix_sinks():
    async def source(label):
        async with trace_redis("agent", label):
            await asyncio.sleep(0)
        yield label

    async def run():
        return await asyncio.gather(collect(lambda: source("one")), collect(lambda: source("two")))

    first, second = asyncio.run(run())
    assert [e["label"] for e in first if isinstance(e, dict)] == ["one", "one"]
    assert [e["label"] for e in second if isinstance(e, dict)] == ["two", "two"]
    assert first[0]["id"] != second[0]["id"]


def test_disconnecting_consumer_cancels_producer_and_closes_source():
    async def run():
        closed = asyncio.Event()

        async def source():
            try:
                async with trace_redis("agent", "Read checkpoint"):
                    await asyncio.Future()
                yield "unreachable"
            finally:
                closed.set()

        stream = stream_with_redis_events(source, lambda e: e)
        assert (await anext(stream))["phase"] == "start"
        await asyncio.wait_for(stream.aclose(), 1)
        assert closed.is_set()

    asyncio.run(run())
