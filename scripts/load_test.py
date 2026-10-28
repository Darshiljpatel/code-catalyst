"""Load test: N simulated judges run the synthetic journey, then keep browsing, for a fixed time.

Usage: python scripts/load_test.py https://your-app.vercel.app --users 25 --minutes 10
Each judge needs its own private demo, and demos are capped per network address per hour,
so on a shared address pass --users up to that cap or raise the cap on a staging deploy.
Reports p50/p95 latency for reads and writes and fails on any 5xx or a p95 read above the target.
"""
import argparse
import json
import statistics
import sys
import threading
import time

import httpx

from synthetic_journey import Journey, JourneyFailed


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1)))]


def judge(base_url, stop_at, results, lock, think_seconds):
    with httpx.Client(base_url=base_url, timeout=30) as client:
        journey = Journey(client, base_url, poll_seconds=120)
        error = None
        try:
            journey.run()
            # Keep browsing like a judge reading results until time is up.
            while time.monotonic() < stop_at:
                journey.call('browse campaigns', 'GET', '/content?limit=20', 200)
                journey.call('browse queue', 'GET', '/me', 200)
                time.sleep(think_seconds)
        except JourneyFailed as failure:
            error = str(failure)
        with lock:
            results['timings'].extend(journey.timings)
            if error:
                results['errors'].append(error)


def summarise(timings, errors, read_target_ms):
    reads = [t['ms'] for t in timings if t['method'] == 'GET']
    writes = [t['ms'] for t in timings if t['method'] != 'GET']
    server_errors = [t for t in timings if t['status'] >= 500]
    summary = dict(requests=len(timings), server_errors=len(server_errors), journey_errors=errors,
                   read_p50_ms=percentile(reads, 50), read_p95_ms=percentile(reads, 95),
                   write_p50_ms=percentile(writes, 50), write_p95_ms=percentile(writes, 95),
                   mean_ms=round(statistics.fmean(t['ms'] for t in timings)) if timings else None)
    summary['ok'] = (not server_errors and not errors and summary['read_p95_ms'] is not None
                     and summary['read_p95_ms'] <= read_target_ms)
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('base_url')
    parser.add_argument('--users', type=int, default=25)
    parser.add_argument('--minutes', type=float, default=10)
    parser.add_argument('--think-seconds', type=float, default=2)
    parser.add_argument('--read-target-ms', type=int, default=800)
    args = parser.parse_args(argv)
    results, lock = dict(timings=[], errors=[]), threading.Lock()
    stop_at = time.monotonic() + args.minutes * 60
    threads = [threading.Thread(target=judge, args=(args.base_url, stop_at, results, lock, args.think_seconds))
               for _ in range(args.users)]
    for thread in threads:
        thread.start()
        time.sleep(0.2)  # Stagger arrivals like judges opening the link.
    for thread in threads:
        thread.join()
    summary = summarise(results['timings'], results['errors'], args.read_target_ms)
    print(json.dumps(summary, indent=2))
    return 0 if summary['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
