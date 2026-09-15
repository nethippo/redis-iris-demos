"""Request-scoped Redis SDK boundaries, with no keys, values or connection details."""
from __future__ import annotations

import asyncio
from contextlib import aclosing, asynccontextmanager, suppress
from contextvars import ContextVar
from time import perf_counter
from uuid import uuid4

from langgraph.checkpoint.redis.aio import AsyncRedisSaver


_trace_context: ContextVar = ContextVar("redis_trace", default=None)


@asynccontextmanager
async def trace_redis(module: str, label: str):
    context = _trace_context.get()
    if context is None:
        yield
        return
    queue, origin = context
    started = perf_counter()
    metadata = {"id": f"redis-{uuid4().hex}", "from": module, "to": "redis", "label": label}

    async def emit(phase):
        now = perf_counter()
        await queue.put(("trace", {**metadata, "phase": phase,
                                  "ts": round((now-origin)*1000),
                                  "durationMs": round((now-started)*1000)}))

    await emit("start")
    try:
        yield
    except asyncio.CancelledError:
        # The consumer has disconnected; do not block trying to emit into its queue.
        raise
    except Exception:
        await emit("error")
        raise
    else:
        await emit("end")


async def stream_with_redis_events(source, encode):
    """Merge SDK events as they occur, including while the model stream is idle.

    A producer task owns the context, so overlapping requests cannot share sinks.
    The bounded queue preserves backpressure; closing the consumer cancels work.
    """
    queue = asyncio.Queue(maxsize=128)

    async def produce():
        token = _trace_context.set((queue, perf_counter()))
        try:
            async with aclosing(source()) as stream:
                async for chunk in stream:
                    await queue.put(("chunk", chunk))
        except Exception as exc:
            await queue.put(("error", exc))
        finally:
            _trace_context.reset(token)
        await queue.put(("done", None))

    producer = asyncio.create_task(produce())
    try:
        while True:
            kind, payload = await queue.get()
            if kind == "done":
                break
            if kind == "error":
                raise payload
            yield encode(payload) if kind == "trace" else payload
    finally:
        producer.cancel()
        with suppress(asyncio.CancelledError):
            await producer


class TracedRedisSaver(AsyncRedisSaver):
    """Observe actual saver calls, not an inferred full-agent execution window."""

    async def aget_tuple(self, *args, **kwargs):
        async with trace_redis("agent", "Read checkpoint"):
            return await super().aget_tuple(*args, **kwargs)

    async def aput(self, *args, **kwargs):
        async with trace_redis("agent", "Write checkpoint"):
            return await super().aput(*args, **kwargs)

    async def aput_writes(self, *args, **kwargs):
        async with trace_redis("agent", "Write checkpoint updates"):
            return await super().aput_writes(*args, **kwargs)
