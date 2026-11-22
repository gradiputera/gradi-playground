"""One JSON object per line on stdout, which Vercel collects as logs.

Callers pass only non-sensitive fields: never tokens, signatures, email addresses or webhook bodies.
"""

import json
import sys
from datetime import UTC, datetime
from typing import Any


def _write(level: str, msg: str, fields: dict[str, Any]) -> None:
    time = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    sys.stdout.write(json.dumps({"time": time, "level": level, "msg": msg, **fields}) + "\n")
    sys.stdout.flush()


def info(msg: str, **fields: Any) -> None:
    _write("info", msg, fields)


def warn(msg: str, **fields: Any) -> None:
    _write("warn", msg, fields)


def error(msg: str, **fields: Any) -> None:
    _write("error", msg, fields)
