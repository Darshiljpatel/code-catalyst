"""P3-compatible entrypoint for the single bounded S5 engine adapter."""
import sys
from brandguard.orchestration import EngineResult
from brandguard.engine_bridge import check_text, _check_text, CATEGORIES as DETERMINISTIC_CATEGORIES


async def create_engine_checker(review_input):
    # Keep the team's worker import path while sharing evidence/scope/timeout policy.
    res = await check_text(review_input)
    # If child subprocess failed (e.g. on Windows where POSIX 'resource' module does not exist):
    if any(c.get("reason") == "engine_process_failed" for c in res.checks) and sys.platform == "win32":
        payload = dict(
            text=getattr(review_input, "text", ""),
            context=getattr(review_input, "context", {}) or {},
            sources=getattr(review_input, "sources", []) or []
        )
        direct_result = _check_text(payload)
        return EngineResult(**direct_result)
    return res

