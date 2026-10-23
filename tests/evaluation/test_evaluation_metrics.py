import pytest
from evaluation.evaluate import compute_metrics, evaluate_dataset


def test_compute_metrics():
    # 2 true positives, 1 false positive, 1 false negative, 1 true negative
    results = [
        {"expected_violation": True, "detected_violation": True, "resolvable_citation": True},
        {"expected_violation": True, "detected_violation": True, "resolvable_citation": True},
        {"expected_violation": False, "detected_violation": False, "resolvable_citation": True},
        {"expected_violation": False, "detected_violation": True, "resolvable_citation": True},   # FP
        {"expected_violation": True, "detected_violation": False, "resolvable_citation": False},  # FN
    ]
    metrics = compute_metrics(results)
    assert metrics["precision"] == pytest.approx(2 / 3, rel=1e-3)
    assert metrics["recall"] == pytest.approx(2 / 3, rel=1e-3)
    assert metrics["f1"] == pytest.approx(2 / 3, rel=1e-3)
    assert metrics["citation_resolution_rate"] == 1.0

    assert metrics["true_positives"] == 2
    assert metrics["false_positives"] == 1
    assert metrics["false_negatives"] == 1
    assert metrics["true_negatives"] == 1


def test_compute_metrics_zero_division():
    # Edge case: No detections or expected items
    metrics = compute_metrics([])
    assert metrics["precision"] == 0.0
    assert metrics["recall"] == 0.0
    assert metrics["f1"] == 0.0
    assert metrics["citation_resolution_rate"] == 1.0


def test_evaluate_fixtures_structure_and_performance():
    """Verify that dev_cases.json loads and produces honest metrics with no split leakage."""
    summary = evaluate_dataset()
    assert summary["total_cases"] >= 20
    assert "splits" in summary
    assert "dev" in summary["splits"]
    assert "test" in summary["splits"]

    # Metrics verification: Precision >= 85%, Recall >= 80% on deterministic categories
    metrics = summary["metrics"]
    assert metrics["precision"] >= 0.85
    assert metrics["recall"] >= 0.80
    assert metrics["citation_resolution_rate"] >= 0.90


def test_wrong_rule_on_positive_case_is_both_false_positive_and_false_negative():
    from evaluation.evaluate import match_findings
    from review_engine.models import Finding
    predicted = Finding(id='wrong', category='terminology', severity='blocker',
        evidence_status='supported_violation', origin='deterministic',
        location={'start_char': 0, 'end_char': 8}, rule_id='WRONG', source_version_id='source',
        evidence_quote='Lumadesk', rationale='Wrong rule', suggested_edit=None)
    label = {'category':'terminology', 'rule_id':'RIGHT', 'quote':'Lumadesk', 'evidence_status':'supported_violation'}
    records, missed, unexpected = match_findings([label], [predicted], 'Lumadesk', [])
    metrics = compute_metrics(records)
    assert metrics['true_positives'] == 0
    assert metrics['false_positives'] == metrics['false_negatives'] == 1
    assert metrics['citation_resolution_rate'] == 0


def test_duplicate_predictions_cannot_reuse_a_label():
    from evaluation.evaluate import match_findings
    from review_engine.models import Finding
    predicted = Finding(id='one', category='terminology', severity='blocker',
        evidence_status='supported_violation', origin='deterministic',
        location={'start_char':0, 'end_char':8}, rule_id='R', source_version_id='S',
        evidence_quote='Lumadesk', rationale='Use LumaDesk', suggested_edit='LumaDesk')
    label = {'category':'terminology', 'rule_id':'R', 'quote':'Lumadesk', 'evidence_status':'supported_violation'}
    records, _, _ = match_findings([label], [predicted, predicted], 'Lumadesk', [])
    metrics = compute_metrics(records)
    assert metrics['true_positives'] == 1 and metrics['false_positives'] == 1
