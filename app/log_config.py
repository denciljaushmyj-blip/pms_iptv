"""
log_config.py
─────────────
Place this file at: app/log_config.py

Call setup_logging() once in main.py at startup.
Produces logs in EXACTLY your expected format:

  2026-04-28 11:12:51,519 WARNING pms.latency MODULE_QUERY: Dashboard Stats = 86.92ms
  2026-04-28 11:12:51,607 WARNING pms.selectors MODULE_QUERY: Food Orders = 4.00ms
"""

import logging
import sys


def setup_logging():
    fmt = logging.Formatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S,%f"[:-3]   # millisecond precision
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(fmt)

    # pms.latency  → request-level logs  (LatencyMiddleware)
    # pms.selectors → query-level logs   (timed_query / latency_block)
    for name in ("pms.latency", "pms.selectors"):
        log = logging.getLogger(name)
        log.setLevel(logging.WARNING)
        if not log.handlers:
            log.addHandler(handler)
        log.propagate = False   # don't double-print via root logger