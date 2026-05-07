"""
latency_middleware.py
─────────────────────
Place this file at: app/latency_middleware.py

Captures:
  - Every HTTP request duration
  - Slow request warnings (>500ms)
  - Per-route module name mapping (matches your expected log format)

Usage in main.py:
  from .latency_middleware import LatencyMiddleware
  app.add_middleware(LatencyMiddleware)
"""

import time
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("pms.latency")

# Threshold in milliseconds — requests slower than this get WARNING level
SLOW_REQUEST_THRESHOLD_MS = 500

# Map URL path prefixes → friendly module names (matches your log format)
MODULE_MAP = {
    "/api/dashboard":           "Dashboard Stats",
    "/api/order":               "Food Order",
    "/api/bar-order":           "Bar Order",
    "/api/spa-booking":         "Spa Booking",
    "/api/entertainment":       "Entertainment Booking",
    "/api/dine-booking":        "Dine Booking",
    "/api/activity-booking":    "Activity Booking",
    "/api/room-service":        "Room Service",
    "/api/guests":              "Guest Lookup",
    "/api/groups":              "Group Booking",
    "/api/current-theme":       "Theme Loader",
    "/api/room-data":           "Room Data",
    "/api/tv":                  "TV Status",
    "/admin/bookings":          "Admin Bookings",
    "/admin/guests":            "Admin Guests",
    "/admin/groups":            "Admin Groups",
    "/admin/tv-data":           "TV Data Page",
    "/admin":                   "Admin Dashboard",
    "/themes":                  "Theme Manager",
    "/schedule_theme":          "Schedule Theme",
    "/discard_theme":           "Discard Theme",
    "/send-message":            "Send Message",
    "/add-tv":                  "Add TV",
    "/delete-guest":            "Delete Guest",
    "/send-group-message":      "Send Group Message",
}


def resolve_module(path: str) -> str:
    """Match a URL path to a friendly module name."""
    for prefix, name in MODULE_MAP.items():
        if path.startswith(prefix):
            return name
    return path  # fallback: show raw path


class LatencyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()

        response = await call_next(request)

        elapsed_ms = (time.perf_counter() - start) * 1000
        module = resolve_module(request.url.path)
        method = request.method
        status = response.status_code

        msg = f"MODULE_QUERY: {module} [{method} {request.url.path}] = {elapsed_ms:.2f}ms  status={status}"

        if elapsed_ms >= SLOW_REQUEST_THRESHOLD_MS:
            logger.warning("⚠️  SLOW  " + msg)
        else:
            logger.warning(msg)   # always WARNING so it matches your expected log format

        # Attach timing header so browser DevTools also shows it
        response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.2f}"

        return response