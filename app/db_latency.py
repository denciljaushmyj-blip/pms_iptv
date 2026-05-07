"""
db_latency.py
─────────────
Place this file at: app/db_latency.py

Wraps SQLAlchemy queries with timing.
Usage:

    from .db_latency import timed_query

    # Instead of:
    result = db.query(models.Order).filter(...).all()

    # Use:
    result = timed_query("Food Orders", db.query(models.Order).filter(...)).all()

Or use the context manager for any block:

    from .db_latency import latency_block
    with latency_block("Dashboard Stats"):
        ...your query code...
"""

import time
import logging
import contextlib

logger = logging.getLogger("pms.selectors")

SLOW_QUERY_THRESHOLD_MS = 200  # queries slower than this get an extra ⚠️ tag


def timed_query(label: str, query):
    """
    Wrap a SQLAlchemy query object with latency logging.
    Returns the same query — caller chains .all(), .first(), .count() etc.

    Example:
        rows = timed_query("Spa Bookings", db.query(SpaBooking).filter(...)).all()
    """
    class TimedQuery:
        def __init__(self, q):
            self._q = q

        def _run(self, method, *args, **kwargs):
            t0 = time.perf_counter()
            result = getattr(self._q, method)(*args, **kwargs)
            ms = (time.perf_counter() - t0) * 1000
            tag = "⚠️ SLOW_QUERY" if ms >= SLOW_QUERY_THRESHOLD_MS else "MODULE_QUERY"
            logger.warning(f"{tag}: {label} = {ms:.2f}ms")
            return result

        def all(self):        return self._run("all")
        def first(self):      return self._run("first")
        def count(self):      return self._run("count")
        def scalar(self):     return self._run("scalar")
        def one(self):        return self._run("one")
        def one_or_none(self):return self._run("one_or_none")

        # Pass-through for filter chaining before terminal call
        def filter(self, *a, **kw):
            self._q = self._q.filter(*a, **kw)
            return self
        def filter_by(self, *a, **kw):
            self._q = self._q.filter_by(*a, **kw)
            return self
        def order_by(self, *a, **kw):
            self._q = self._q.order_by(*a, **kw)
            return self
        def limit(self, n):
            self._q = self._q.limit(n)
            return self
        def offset(self, n):
            self._q = self._q.offset(n)
            return self

    return TimedQuery(query)


@contextlib.contextmanager
def latency_block(label: str):
    """
    Context manager for timing any arbitrary block of code.

    Example:
        with latency_block("Dashboard Stats calculation"):
            result = some_heavy_function()
    """
    t0 = time.perf_counter()
    try:
        yield
    finally:
        ms = (time.perf_counter() - t0) * 1000
        tag = "⚠️ SLOW_BLOCK" if ms >= SLOW_QUERY_THRESHOLD_MS else "MODULE_QUERY"
        logger.warning(f"{tag}: {label} = {ms:.2f}ms")