"""BrandGuard Quality Evaluation Suite (Case T23).
Evaluates precision, recall, citation resolution, and latency across frozen template-split fixtures.
"""
import json
import logging
import math
import os
import sys
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

# Ensure packages directory is importable
packages_dir = Path(__file__).resolve().parents[1] / "packages"
if str(packages_dir) not in sys.path:
    sys.path.insert(0, str(packages_dir))

from review_engine.extraction import extract
from review_engine.deterministic import check
from review_engine.models import ExtractionResult, CheckResult


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("brandguard.evaluation")


def compute_metrics(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Computes precision, recall, f1, and citation resolution rate."""
    tp = sum(1 for r in results if r.get("expected_violation") and r.get("detected_violation"))
    fp = sum(1 for r in results if not r.get("expected_violation") and r.get("detected_violation"))
    fn = sum(1 for r in results if r.get("expected_violation") and not r.get("detected_violation"))
    tn = sum(1 for r in results if not r.get("expected_violation") and not r.get("detected_violation"))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    citations = [r.get("resolvable_citation", False) for r in results if r.get("detected_violation")]
    cit_rate = sum(1 for c in citations if c) / len(citations) if citations else 1.0

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "citation_resolution_rate": round(cit_rate, 4),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "total_evaluations": len(results)
    }


def percentile(values: List[float], p: float) -> float:
    """Calculates percentile from sorted values."""
    if not values:
        return 0.0
    sorted_vals = sorted(values)
    idx = (len(sorted_vals) - 1) * p
    floor_idx = int(math.floor(idx))
    ceil_idx = int(math.ceil(idx))
    if floor_idx == ceil_idx:
        return sorted_vals[floor_idx]
    return sorted_vals[floor_idx] * (ceil_idx - idx) + sorted_vals[ceil_idx] * (idx - floor_idx)


def evaluate_dataset(dataset_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Evaluates the review engine against frozen fixtures in dev_cases.json.
    Reports global metrics, per-split metrics (dev vs test), and per-category breakdowns.
    """
    if dataset_path is None:
        dataset_path = Path(__file__).resolve().parent / "fixtures" / "dev_cases.json"
    else:
        dataset_path = Path(dataset_path)

    if not dataset_path.exists():
        raise FileNotFoundError(f"Fixture dataset not found at {dataset_path}")

    with open(dataset_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    all_evaluations = []
    split_evaluations: Dict[str, List[Dict[str, Any]]] = {}
    category_evaluations: Dict[str, List[Dict[str, Any]]] = {}
    latencies: List[float] = []
    disagreements = []

    for case in cases:
        case_id = case["id"]
        split = case.get("split", "dev")
        text = case.get("text", "")
        context = case.get("context", {})
        sources = case.get("sources", [])
        expected_findings = case.get("expected_findings", [])
        expected_has_violations = len(expected_findings) > 0

        # Build rule ID lookup to verify citation resolvability
        valid_rule_ids = {r["id"] for s in sources for r in s.get("rules", []) if "id" in r}

        # Measure review engine execution latency
        t0 = time.perf_counter()
        extraction: ExtractionResult = extract(text.encode("utf-8"), "text/plain", {})
        check_results: List[CheckResult] = check(extraction, context, sources)
        latency_ms = (time.perf_counter() - t0) * 1000.0
        latencies.append(latency_ms)

        detected_findings = [f for cr in check_results for f in cr.findings]
        detected_has_violations = len(detected_findings) > 0

        # Verify citation resolvability
        all_citations_resolvable = all(
            f.rule_id in valid_rule_ids
            for f in detected_findings
            if f.rule_id is not None
        )

        eval_record = {
            "case_id": case_id,
            "split": split,
            "expected_violation": expected_has_violations,
            "detected_violation": detected_has_violations,
            "resolvable_citation": all_citations_resolvable,
            "latency_ms": round(latency_ms, 2)
        }
        all_evaluations.append(eval_record)

        if split not in split_evaluations:
            split_evaluations[split] = []
        split_evaluations[split].append(eval_record)

        # Track per-category results
        for exp in expected_findings:
            cat = exp.get("category", "general")
            matched = any(
                df.category == cat and (
                    df.rule_id == exp.get("rule_id") or
                    exp.get("quote", "") in df.evidence_quote or
                    (isinstance(df.location, dict) and 
                     0 <= df.location.get("start_char", 0) < df.location.get("end_char", 0) <= len(text) and 
                     exp.get("quote", "") in text[df.location["start_char"]:df.location["end_char"]])
                )
                for df in detected_findings
            )
            cat_rec = {

                "case_id": case_id,
                "category": cat,
                "expected_violation": True,
                "detected_violation": matched,
                "resolvable_citation": True
            }
            category_evaluations.setdefault(cat, []).append(cat_rec)

        # Check for false alarms in negative cases
        if not expected_has_violations and detected_has_violations:
            disagreements.append({
                "case_id": case_id,
                "type": "false_positive",
                "text": text,
                "unexpected_findings": [f.model_dump() for f in detected_findings]
            })
        elif expected_has_violations and not detected_has_violations:
            disagreements.append({
                "case_id": case_id,
                "type": "false_negative",
                "text": text,
                "missed_expected": expected_findings
            })

    global_metrics = compute_metrics(all_evaluations)

    per_split_metrics = {
        s: compute_metrics(evals) for s, evals in split_evaluations.items()
    }

    per_category_metrics = {
        cat: compute_metrics(evals) for cat, evals in category_evaluations.items()
    }

    latency_summary = {
        "p50_ms": round(percentile(latencies, 0.50), 2),
        "p95_ms": round(percentile(latencies, 0.95), 2),
        "min_ms": round(min(latencies), 2) if latencies else 0.0,
        "max_ms": round(max(latencies), 2) if latencies else 0.0,
        "mean_ms": round(sum(latencies) / len(latencies), 2) if latencies else 0.0
    }

    return {
        "dataset": str(dataset_path.name),
        "total_cases": len(cases),
        "splits": list(split_evaluations.keys()),
        "metrics": global_metrics,
        "per_split_metrics": per_split_metrics,
        "per_category_metrics": per_category_metrics,
        "latency": latency_summary,
        "disagreements_count": len(disagreements),
        "disagreements": disagreements
    }


def main():
    logger.info("Starting BrandGuard Case T23 Quality Evaluation...")
    summary = evaluate_dataset()

    print("\n" + "=" * 60)
    print("           BRANDGUARD QUALITY EVALUATION (CASE T23)          ")
    print("=" * 60)
    m = summary["metrics"]
    print(f"Total Cases:               {summary['total_cases']}")
    print(f"Precision:                 {m['precision'] * 100:.1f}% (target >= 85%)")
    print(f"Recall:                    {m['recall'] * 100:.1f}% (target >= 80%)")
    print(f"F1 Score:                  {m['f1']:.4f}")
    print(f"Citation Resolution Rate:  {m['citation_resolution_rate'] * 100:.1f}% (target >= 90%)")
    print(f"True Positives:            {m['true_positives']}")
    print(f"False Positives:           {m['false_positives']}")
    print(f"False Negatives:           {m['false_negatives']}")
    print(f"True Negatives:            {m['true_negatives']}")
    print("-" * 60)

    print("PER-SPLIT METRICS:")
    for split, sm in summary["per_split_metrics"].items():
        print(f"  [{split.upper()}] (n={sm['total_evaluations']}): Precision={sm['precision']*100:.1f}%, Recall={sm['recall']*100:.1f}%, F1={sm['f1']:.4f}")
    print("-" * 60)

    lat = summary["latency"]
    print("LATENCY:")
    print(f"  p50: {lat['p50_ms']} ms | p95: {lat['p95_ms']} ms | mean: {lat['mean_ms']} ms")
    print("=" * 60 + "\n")

    # Persist evidence artifact for Case T23
    evidence_dir = Path("verification/evidence")
    evidence_dir.mkdir(parents=True, exist_ok=True)
    evidence_path = evidence_dir / "t23_evaluation.json"

    with open(evidence_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    logger.info(f"Evaluation evidence written to {evidence_path}")

    # Threshold checks
    if m["precision"] < 0.85 or m["recall"] < 0.80 or m["citation_resolution_rate"] < 0.90:
        logger.error("Evaluation did not meet minimum target thresholds!")
        sys.exit(1)
    else:
        logger.info("All quality evaluation benchmarks passed successfully.")


if __name__ == "__main__":
    main()
