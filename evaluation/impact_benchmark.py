"""Impact benchmark (Improvement 1): 30 campaigns x 5 guideline changes = 150 change scenarios.

Every campaign is analysed once under the original guidelines with the local engine and stored in a
throwaway in-memory database, exactly as a finished review run is stored. Each change is then put through
the app's own `impact.compute_impact` (the code behind the impact preview and activation).

Two ground truths are reported side by side:
- re-analysis: the local engine's findings for the campaign differ under the new rules (the masterplan's
  definition). The impact "confirmed" level uses the same local re-check, so agreement there is expected.
- human labels: which changes alter the correct review outcome of each campaign, written with the dataset
  before the first run. They include cases the local engine cannot read (for example "two weeks free").

Re-reviews avoided compares approvals sent back to a person with brand-wide invalidation (every approval in
the brand reopened, the old epoch behaviour). Shipped routing: confirmed and likely approvals go back to a
reviewer; possible ones keep their approval unless their recheck gives different findings (then they are
escalated). Locally the recheck is the same re-analysis as the ground truth above. Local checks only; AI
findings need a live key.
Usage: python -m evaluation.impact_benchmark
"""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT / 'apps/api', ROOT / 'packages'):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from brandguard.evaluation import evaluate_many, compare  # noqa: E402
from brandguard.impact import compute_impact, ON_HOLD_STATES  # noqa: E402
from brandguard.models import Base, ContentItem, ContentRevision, ReviewRun, RunSource, Finding, SourceVersion  # noqa: E402
from brandguard.schemas import SourceOut  # noqa: E402
from evaluation.benchmark_v2 import wilson  # noqa: E402

DATASET = Path(__file__).resolve().parent / 'fixtures' / 'impact_benchmark.json'
# Frozen with the labels before the first run; update only with a new dataset version.
DATASET_SHA256 = '23c20cf670a83ca0303acf2b7135ceb0bc48ae87f0c8f093406ccf2f419555e2'
RESULTS = Path(__file__).resolve().parent / 'results' / 'impact_benchmark.json'
ORG, BRAND, OWNER = 'org-impact-benchmark', 'brand-impact-benchmark', 'manager-impact-benchmark'
AT = datetime(2026, 1, 1, tzinfo=timezone.utc)
TIERS = dict(listed=('confirmed', 'likely', 'possible'), confirmed_or_likely=('confirmed', 'likely'), confirmed=('confirmed',))


def source_version(spec, version, rules=None, text=None):
    text = spec['text'] if text is None else text
    return SourceVersion(id=f"{spec['source_key']}-v{version}", org_id=ORG, brand_id=BRAND, source_key=spec['source_key'],
        version=version, owner_id=OWNER, title=spec['title'], text=text, text_hash=hashlib.sha256(text.encode()).hexdigest(),
        rules=rules if rules is not None else spec['rules'], valid_from=AT, valid_until=None, state='active', created_at=AT,
        activated_by=OWNER, activated_at=AT)


def snapshot(sources):
    return sorted((SourceOut.model_validate(s).model_dump(mode='json') for s in sources), key=lambda s: s['id'])


def changed_source(spec, change):
    rules = json.loads(json.dumps(spec['rules']))
    text = spec['text']
    if change['op'] == 'remove':
        rules = [r for r in rules if r['id'] != change['rule_id']]
    elif change['op'] == 'add':
        rules.append(change['rule'])
        text += change['text_append']
    else:
        for rule in rules:
            if rule['id'] == change['rule_id']:
                if change.get('value'):
                    text = text.replace(rule['evidence_quote'], change['quote'])
                    rule.update(value=change['value'], evidence_quote=change['quote'])
                if change.get('allowed_variants'):
                    rule['allowed_variants'] = change['allowed_variants']
    return source_version(spec, 2, rules, text)


def analyse(session, campaigns, sources):
    """Store one finished local review run per campaign, as the worker would."""
    old = snapshot(sources)
    results = evaluate_many([dict(text=c['text'], context=c['context']) for c in campaigns], old)
    for campaign, result in zip(campaigns, results):
        assert not any(c['status'] == 'failed' for c in result['checks']), (campaign['id'], result['checks'])
        item = ContentItem(org_id=ORG, brand_id=BRAND, creator_id='creator', reviewer_id='reviewer', title=campaign['id'],
                           current_revision=1, state=campaign['state'], created_at=AT)
        session.add(item); session.flush()
        revision = ContentRevision(org_id=ORG, item_id=item.id, number=1, author_id='creator', text=campaign['text'],
            text_hash=hashlib.sha256(campaign['text'].encode()).hexdigest(), channel=campaign['context']['channel'],
            audience=campaign['context']['audience'], purpose=campaign['context']['purpose'], created_at=AT)
        session.add(revision); session.flush()
        run = ReviewRun(org_id=ORG, revision_id=revision.id, idempotency_key=f"bench:{campaign['id']}", source_epoch=1,
                        source_snapshot=old, checks=result['checks'], status='complete', created_at=AT, trigger='creator')
        session.add(run); session.flush()
        session.add_all(RunSource(org_id=ORG, run_id=run.id, source_id=s['id']) for s in old)
        for f in result['findings']:
            f = dict(f)
            start, end, quote = f.pop('start'), f.pop('end'), f.pop('content_quote')
            session.add(Finding(org_id=ORG, run_id=run.id, revision_id=revision.id, origin='deterministic', resolution='unresolved',
                                location=dict(block_id='text', start=start, end=end, quote=quote), **f))
    session.commit()
    return old, results


def scores(predicted, actual, universe):
    tp, fp, fn = len(predicted & actual), len(predicted - actual), len(actual - predicted)
    return dict(true_positives=tp, false_positives=fp, false_negatives=fn, true_negatives=len(universe - predicted - actual),
                precision=round(tp / (tp + fp), 4) if tp + fp else None, precision_ci95=wilson(tp, tp + fp),
                recall=round(tp / (tp + fn), 4) if tp + fn else None, recall_ci95=wilson(tp, tp + fn))


def run(dataset=DATASET):
    raw = Path(dataset).read_bytes()
    data = json.loads(raw)
    campaigns = data['campaigns']
    specs = {s['source_key']: s for s in data['sources']}
    originals = {key: source_version(spec, 1) for key, spec in specs.items()}
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    pairs = dict(listed=set(), confirmed_or_likely=set(), confirmed=set(), reanalysis=set(), human=set(), routed=set())
    per_change, universe = [], set()
    approved = {c['id'] for c in campaigns if c['state'] == 'approved'}
    on_hold = {c['id'] for c in campaigns if c['state'] in ON_HOLD_STATES}
    with Session(engine) as session:
        old, before = analyse(session, campaigns, originals.values())
        brand = type('Brand', (), dict(id=BRAND))()  # compute_impact reads only brand.id
        for change in data['changes']:
            new_source = changed_source(specs[change['source_key']], change)
            retired = [originals[change['source_key']]]
            new = snapshot([s for k, s in originals.items() if k != change['source_key']] + [new_source])
            impact = compute_impact(session, ORG, brand, new_source, retired, new)
            levels = {e['title']: e['impact_level'] for e in impact['entries']}
            held = {e['title'] for e in impact['entries'] if e['routing'] == 'hold'}
            kept = {e['title'] for e in impact['entries'] if e['routing'] == 'keep'}
            after = evaluate_many([dict(text=c['text'], context=c['context']) for c in campaigns], new)
            truth = {c['id'] for c, b, a in zip(campaigns, before, after) if compare(b, a, old, new)['changed']}
            human = {c['id'] for c in campaigns if change['id'] in c['human_affected_by']}
            tiers = {tier: {i for i, level in levels.items() if level in accepted} for tier, accepted in TIERS.items()}
            ids = {c['id'] for c in campaigns}
            # A kept campaign whose recheck finds a difference is escalated to confirmed and goes back too.
            routed = held | (kept & truth)
            pairs['routed'] |= {(change['id'], i) for i in routed}
            for name, chosen in (*tiers.items(), ('reanalysis', truth), ('human', human)):
                pairs[name] |= {(change['id'], i) for i in chosen}
            universe |= {(change['id'], i) for i in ids}
            per_change.append(dict(change=change['id'], name=change['name'], listed=len(tiers['listed']),
                levels={k: impact['counts'][k] for k in ('confirmed', 'likely', 'possible')},
                not_affected=impact['counts']['not_affected'], reanalysis_affected=sorted(truth), human_affected=sorted(human),
                missed_by_listing=sorted(truth - tiers['listed']), confirmed_missing_human=sorted(human - tiers['confirmed']),
                confirmed_not_human=sorted(tiers['confirmed'] - human),
                approvals_reopened_brand_wide=len(approved), approvals_sent_back_if_every_listed=len(approved & tiers['listed']),
                approvals_sent_back=len(approved & routed), approvals_kept=len(approved & (kept - truth)),
                approvals_escalated_by_recheck=len(approved & kept & truth),
                in_review_kept=len((on_hold - approved) & (kept - truth)),
                approvals_needing_review_by_label=len(approved & human),
                approvals_sent_back_if_routed_by_confirmed=len(approved & tiers['confirmed'])))
    measured = {f'{tier}_vs_{truth}': scores(pairs[tier], pairs[truth], universe)
                for tier in TIERS for truth in ('reanalysis', 'human')}
    measured['reanalysis_vs_human'] = scores(pairs['reanalysis'], pairs['human'], universe)
    brand_wide = sum(c['approvals_reopened_brand_wide'] for c in per_change)
    sent_back = sum(c['approvals_sent_back'] for c in per_change)
    every_listed = sum(c['approvals_sent_back_if_every_listed'] for c in per_change)
    gated = sum(c['approvals_sent_back_if_routed_by_confirmed'] for c in per_change)
    needed = sum(c['approvals_needing_review_by_label'] for c in per_change)
    approved_pairs = {(ch['id'], i) for ch in data['changes'] for i in approved}
    shipped_missed = sorted(f'{c}:{i}' for c, i in (pairs['human'] & approved_pairs) - pairs['routed'])
    gated_missed = sorted(f'{c}:{i}' for c, i in (pairs['human'] & approved_pairs) - pairs['confirmed'])
    return dict(benchmark='impact_improvement_1', origin='local', synthetic=True, dataset=str(Path(dataset).name),
        dataset_sha256=hashlib.sha256(raw).hexdigest(), frozen=hashlib.sha256(raw).hexdigest() == DATASET_SHA256,
        campaigns=len(campaigns), changes=len(data['changes']), scenarios=len(universe),
        campaign_states=dict(approved=len(approved), on_hold=len(on_hold), total=len(campaigns)),
        metrics=measured,
        re_reviews=dict(
            brand_wide_invalidation=brand_wide,
            shipped_routing=dict(rule='confirmed + likely go back; possible keeps approval unless the recheck differs',
                approvals_sent_back=sent_back, avoided=brand_wide - sent_back,
                avoided_rate=round((brand_wide - sent_back) / brand_wide, 4), avoided_ci95=wilson(brand_wide - sent_back, brand_wide),
                escalated_by_recheck=sum(c['approvals_escalated_by_recheck'] for c in per_change),
                labelled_approvals_missed=shipped_missed),
            previous_routing_every_listed=dict(approvals_sent_back=every_listed, avoided=brand_wide - every_listed),
            approvals_needing_review_by_label=needed,
            if_routed_by_confirmed_level=dict(approvals_sent_back=gated, avoided=brand_wide - gated,
                avoided_rate=round((brand_wide - gated) / brand_wide, 4), avoided_ci95=wilson(brand_wide - gated, brand_wide),
                labelled_approvals_missed=gated_missed, note='Not shipped; for comparison only.')),
        per_change=per_change,
        gates=dict(impact_recall_100=measured['listed_vs_reanalysis']['recall'] == 1.0))


def main():
    result = run()
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(result, indent=2) + '\n')
    m, rr = result['metrics'], result['re_reviews']
    print(f"Impact benchmark: {result['campaigns']} synthetic campaigns x {result['changes']} changes = {result['scenarios']} scenarios (local checks).")
    for tier in TIERS:
        for truth in ('reanalysis', 'human'):
            s = m[f'{tier}_vs_{truth}']
            print(f"  {tier:<20} vs {truth:<10}: recall {s['recall']} {s['recall_ci95']}, precision {s['precision']} {s['precision_ci95']}")
    shipped, gated = rr['shipped_routing'], rr['if_routed_by_confirmed_level']
    print(f"  Re-reviews: brand-wide {rr['brand_wide_invalidation']}, shipped routing {shipped['approvals_sent_back']} "
          f"(avoided {shipped['avoided']} {shipped['avoided_ci95']}, {shipped['escalated_by_recheck']} escalated by the recheck, "
          f"{len(shipped['labelled_approvals_missed'])} labelled approvals missed: {shipped['labelled_approvals_missed']}); "
          f"every listed {rr['previous_routing_every_listed']['approvals_sent_back']}; if routed by confirmed only "
          f"{gated['approvals_sent_back']} ({len(gated['labelled_approvals_missed'])} missed); "
          f"labels say {rr['approvals_needing_review_by_label']} needed.")
    print(f'Written to {RESULTS}')
    return 0 if result['frozen'] and all(result['gates'].values()) else 1


if __name__ == '__main__':
    sys.exit(main())
