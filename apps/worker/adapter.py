"""P3-compatible entrypoint for the single bounded S5 engine adapter."""
from brandguard.orchestration import EngineResult
from brandguard.engine_bridge import check_text, CATEGORIES as DETERMINISTIC_CATEGORIES


async def create_engine_checker(review_input):
    # Keep the team's worker import path while sharing evidence/scope/timeout policy.
    return await check_text(review_input)
