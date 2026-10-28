"""Synthetic judge journey against a running BrandGuard: private demo -> campaign -> check -> findings.

Usage: python scripts/synthetic_journey.py https://your-app.vercel.app
Exits 1 with the failing step when any step breaks, so a scheduled CI job alerts the team.
Uses only the public API and a fresh private demo workspace; it never touches real tenants.
"""
import argparse
import json
import sys
import time
import uuid

import httpx

DRAFT = 'Meet Lumadesk. Start your 30-day free trial today.'
CONTEXT = dict(channel='email', audience='Small teams', purpose='Synthetic journey check')


class JourneyFailed(Exception):
    def __init__(self, step, detail):
        super().__init__(f'{step}: {detail}')
        self.step, self.detail = step, detail


class Journey:
    """One simulated judge. `client` is any httpx.Client (TestClient in tests); `wait` is called between polls."""

    def __init__(self, client, origin, *, wait=lambda: time.sleep(1), poll_seconds=90):
        self.client, self.origin, self.wait, self.poll_seconds = client, origin.rstrip('/'), wait, poll_seconds
        self.headers = {'origin': self.origin}
        self.timings = []

    def call(self, step, method, path, expect, **kwargs):
        started = time.monotonic()
        try:
            response = self.client.request(method, '/api/v1' + path, headers={**self.headers, **kwargs.pop('headers', {})}, **kwargs)
        except httpx.HTTPError as error:
            raise JourneyFailed(step, type(error).__name__)
        self.timings.append(dict(step=step, method=method, status=response.status_code, ms=round((time.monotonic() - started) * 1000)))
        if response.status_code != expect:
            raise JourneyFailed(step, f'HTTP {response.status_code}: {response.text[:200]}')
        return response.json()

    def sign_in(self, role='creator'):
        body = self.call('create private demo', 'POST', '/demo/sandboxes', 201, json=dict(role=role))
        self.headers['x-csrf-token'] = body['csrf_token']
        return body

    def campaign(self):
        brands = self.call('list brands', 'GET', '/brands', 200)
        brand = next((b for b in brands if b['name'] == 'LumaDesk'), None)
        if brand is None:
            raise JourneyFailed('list brands', 'LumaDesk demo brand missing')
        self.call('list campaigns', 'GET', '/content?limit=20', 200)
        item = self.call('create campaign', 'POST', '/content', 201,
                         json=dict(brand_id=brand['id'], title='Synthetic journey', text=DRAFT, **CONTEXT))
        return item

    def analyse(self, item):
        revision = item['revisions'][0]['id']
        run = self.call('start check', 'POST', f'/revisions/{revision}/analysis', 202, json={},
                        headers={'Idempotency-Key': 'synthetic-' + uuid.uuid4().hex})
        deadline = time.monotonic() + self.poll_seconds
        while run['status'] in ('queued', 'running'):
            if time.monotonic() > deadline:
                raise JourneyFailed('wait for check', f'still {run["status"]} after {self.poll_seconds}s (is the worker online?)')
            self.wait()
            run = self.call('poll check', 'GET', f'/runs/{run["id"]}', 200)
        rules = {f['rule_id'] for f in run['findings']}
        # The draft deliberately misspells the brand and states the wrong trial length.
        if not {'T01', 'F01'} <= rules:
            raise JourneyFailed('check findings', f'expected T01 and F01, got {sorted(rules)}')
        return run

    def run(self):
        ready = self.call('health', 'GET', '/health/ready', 200)
        if ready.get('worker') != 'online':
            raise JourneyFailed('health', f'worker is {ready.get("worker")}')
        self.sign_in()
        run = self.analyse(self.campaign())
        self.call('open campaign', 'GET', f'/runs/{run["id"]}', 200)
        return self.timings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('base_url', help='Web origin that proxies /api, e.g. https://brandguard.vercel.app')
    parser.add_argument('--poll-seconds', type=int, default=90)
    args = parser.parse_args(argv)
    with httpx.Client(base_url=args.base_url, timeout=30, follow_redirects=False) as client:
        try:
            timings = Journey(client, args.base_url, poll_seconds=args.poll_seconds).run()
        except JourneyFailed as failure:
            print(json.dumps(dict(ok=False, step=failure.step, detail=failure.detail)))
            return 1
    print(json.dumps(dict(ok=True, total_ms=sum(t['ms'] for t in timings), steps=timings)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
