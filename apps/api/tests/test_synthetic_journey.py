import sys
from pathlib import Path
from datetime import datetime, timezone
from test_identity import setup
from test_impact import drain
from sqlalchemy import delete
from sqlalchemy.orm import Session
from brandguard.health import beat
from brandguard.models import WorkerHeartbeat

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts'))
from synthetic_journey import Journey, JourneyFailed  # noqa: E402
from load_test import summarise, percentile  # noqa: E402


def test_synthetic_journey_runs_a_private_demo_check_end_to_end(setup):
    c, engine, _, _ = setup
    beat(engine, 'synthetic-test-worker', datetime.now(timezone.utc))
    timings = Journey(c, 'https://testserver', wait=lambda: drain(engine)).run()
    steps = [t['step'] for t in timings]
    assert steps[:4] == ['health', 'create private demo', 'list brands', 'list campaigns']
    assert 'start check' in steps and all(t['status'] < 400 for t in timings)


def test_synthetic_journey_names_the_failing_step(setup):
    c, engine, _, _ = setup
    with Session(engine) as db:
        db.execute(delete(WorkerHeartbeat)); db.commit()
    try:
        Journey(c, 'https://testserver').run()
    except JourneyFailed as failure:
        assert failure.step == 'health' and 'worker' in failure.detail
    else:
        raise AssertionError('a missing worker must fail the journey')
    beat(engine, 'synthetic-test-worker', datetime.now(timezone.utc))
    journey = Journey(c, 'https://testserver', wait=lambda: None, poll_seconds=0)
    try:
        journey.run()
    except JourneyFailed as failure:
        assert failure.step == 'wait for check'


def test_load_summary_fails_on_server_errors_or_slow_reads():
    timings = [dict(step='s', method='GET', status=200, ms=ms) for ms in range(100, 1100, 100)]
    assert percentile([5, 1, 3], 50) == 3
    assert not summarise(timings, [], 800)['ok'] and summarise(timings, [], 1000)['ok']
    assert not summarise(timings + [dict(step='w', method='POST', status=503, ms=5)], [], 1000)['ok']
