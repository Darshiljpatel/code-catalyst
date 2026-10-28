import time
import pytest
from unittest.mock import MagicMock, patch
from apps.worker.runner import run_worker_loop, get_reviewer


def test_runner_once_mode_exits_after_single_job():
    """Verify that run_worker_loop with once=True processes at most one job and returns."""
    mock_engine = MagicMock()
    mock_reviewer = MagicMock()
    mock_checker = MagicMock()

    with patch("brandguard.orchestration.process_one", return_value=True) as mock_proc:
        run_worker_loop(mock_engine, mock_reviewer, mock_checker, poll_interval=0.01, once=True)
        assert mock_proc.call_count == 1
        mock_proc.assert_called_once_with(mock_engine, mock_reviewer, checker=mock_checker)


def test_runner_once_mode_exits_when_queue_empty():
    """Verify that once=True exits even if no job was pending in the queue."""
    mock_engine = MagicMock()
    mock_reviewer = MagicMock()
    mock_checker = MagicMock()

    with patch("brandguard.orchestration.process_one", return_value=False) as mock_proc:
        run_worker_loop(mock_engine, mock_reviewer, mock_checker, poll_interval=0.01, once=True)
        assert mock_proc.call_count == 1


def test_runner_catches_unexpected_exception_safely():
    """Verify worker safely handles runtime errors without unhandled exit."""
    mock_engine = MagicMock()
    mock_reviewer = MagicMock()
    mock_checker = MagicMock()

    with patch("brandguard.orchestration.process_one", side_effect=RuntimeError("Database disconnected")):
        # In once mode, it catches the error and exits cleanly
        run_worker_loop(mock_engine, mock_reviewer, mock_checker, poll_interval=0.01, once=True)


def test_get_reviewer_fallback_stub():
    """Verify that if Nebius is unconfigured, get_reviewer returns a safe fallback stub."""
    with patch.dict("os.environ", {}, clear=True):
        rev = get_reviewer()
        assert rev.config.model is not None


# ===========================================================================
# Test Cases T14 & T15 Contract Invariants
# ===========================================================================

def test_t14_attempts_exhaustion_in_orchestration():
    """
    Test Case T14 invariant:
    When a job reaches 3 attempts, orchestration marks checks failed with attempts_exhausted.
    """
    from brandguard.orchestration import analyse_claim, ClaimedRun, ReviewInput
    from datetime import datetime, timezone

    # Simulate an exhausted claim
    exhausted_claim = ClaimedRun(
        job_id="job-1",
        run_id="run-1",
        org_id="org-1",
        lease_token="tok",
        item_id="item-1",
        revision_id="rev-1",
        claimed_at=datetime.now(timezone.utc),
        processing={},
        review_input=ReviewInput(text="Sample text", context={}, sources=[]),
        exhausted=True
    )

    import asyncio
    checks, findings, metadata = asyncio.run(
        analyse_claim(MagicMock(), exhausted_claim, MagicMock(), checker=None)
    )

    assert all(c["status"] == "failed" for c in checks)
    assert all(c["reason"] == "attempts_exhausted" for c in checks)
    assert metadata.get("error_code") == "attempts_exhausted"
    assert len(findings) == 0


def test_t15_deadline_exceeded_in_orchestration():
    """
    Test Case T15 invariant:
    When remaining deadline <= 0, analysis fails with deadline_exceeded rather than silent pass.
    """
    from brandguard.orchestration import analyse_claim, ClaimedRun, ReviewInput
    from datetime import datetime, timezone, timedelta

    # Claim created 70 seconds ago (exceeding the 60s total deadline)
    expired_claim = ClaimedRun(
        job_id="job-1",
        run_id="run-1",
        org_id="org-1",
        lease_token="tok",
        item_id="item-1",
        revision_id="rev-1",
        claimed_at=datetime.now(timezone.utc) - timedelta(seconds=70),
        processing={},
        review_input=ReviewInput(text="Sample text", context={}, sources=[]),
        exhausted=False
    )

    import asyncio
    checks, findings, metadata = asyncio.run(
        analyse_claim(MagicMock(), expired_claim, MagicMock(), checker=None)
    )

    assert all(c["status"] == "failed" for c in checks)
    assert all(c["reason"] == "deadline_exceeded" for c in checks)
    assert metadata.get("error_code") == "deadline_exceeded"
    assert len(findings) == 0
