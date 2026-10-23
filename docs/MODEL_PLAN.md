# Model selection from the team's purchased catalogue

Updated 23 October 2026 using `models.txt`. The team reports purchased access; the file is a catalogue snapshot, not a successful API connection or evidence that a dedicated deployment is provisioned. The team has now identified Nebius Token Factory and supplied the API example: base URL `https://api.tokenfactory.nebius.com/v1/`, primary ID `Qwen/Qwen3-235B-A22B-Instruct-2507`, key environment variable `NEBIUS_API_KEY`. Exact account access, quotas and fallback ID still need verification. No live request has been made. Use a replacement key supplied through the environment after revoking the key exposed in chat. Keep credentials out of this file and the repository.

## Proposed selection

| Role | Catalogue model | Use and selection gate |
|---|---|---|
| Primary candidate | Qwen3-235B-A22B-Instruct-2507 | Grounded tone/messaging review, identification of claims needing evidence, editable suggestions. Adopt after evaluating output quality and end-to-end latency. |
| Lower-cost fallback candidate | Qwen3-30B-A3B-Instruct-2507 | Same task and response contract. Enable only after independent evaluation; record when used. It may become the primary if it meets quality gates and the larger candidate misses latency. |
| Retrieval, deferred | Qwen3-Embedding-8B | Already in the catalogue. Evaluate only if lexical retrieval misses relevant sources on labelled cases; not required for the small Round 2 brand pack. |

The two text candidates are instruction models with officially documented non-thinking operation. That makes them reasonable candidates for bounded responses without a reasoning transcript; it does not guarantee valid JSON or superior brand-review accuracy. See the [official 235B model card](https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507) and [official 30B model card](https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507). This recommendation is an engineering hypothesis to test, not a benchmark result.

Do not infer the hosting provider's accepted model ID from the display name or Hugging Face repository name. Confirm API dialect, schema-output support, supported sampling settings, maximum output, cancellation, timeouts and usage reporting against that provider's documentation. The catalogue does not establish those capabilities. Do not assume a listed vision-capable model accepts images through this particular endpoint.

Keep deterministic terminology, structured facts, asset hashes, image dimensions and declared contrast checks in code. PNG/JPEG intake and optional local OCR remain in scope; a second vision-model integration is not needed for Round 2. This keeps the integration within the existing three-person allocation.

## Runtime contract

Send the canonical content blocks, audience/channel/purpose and a bounded set of eligible approved passages. First filter by organisation, brand, permissions, activation and validity; retrieval never crosses tenants. Ask for the existing finding schema and a concise evidence-based rationale. No tools, autonomous approvals or automatic edits. A model cannot invent approved brand facts.

Start with at most 6,000 input tokens and 512 output tokens per semantic call; these are application budget targets, not provider limits. Token accounting must use the selected model's supported tokenizer or provider usage information. Long documents need bounded chunks with canonical location mappings and explicit per-chunk status. Never silently truncate a document and label the whole review complete. A truncated JSON response is a failed check, not an empty finding list.

Use a single total 60-second review deadline, including queue/extraction/model time, with a 30-second p95 target for the supported demo workload. Chunk processing must fit within that deadline or return incomplete. Benchmark real first-token delay and complete response time: catalogue tokens/second are not end-to-end latency guarantees. A 512-token cap also limits finding count; overflow must trigger a visible incomplete result or an explicit follow-up chunk, never dropped findings.

Allow a bounded retry or evaluated fallback only for retryable transport/rate-limit failures and only within the remaining deadline. Honour retry-after where feasible; otherwise leave the run incomplete. Invalid citations, schema failures or semantic disagreement do not trigger a search for a model that will approve the content. Automatic fallback must be explicitly enabled in workspace provider policy and stay within its approved processing boundary; a different region/provider needs separate policy coverage. If neither candidate succeeds, preserve deterministic findings and mark semantic checks unavailable/failed.

Record requested model/endpoint ID, returned model ID where provided, provider, prompt version, parameters, source snapshot, token usage, latency and fallback reason. Never silently replace the requested model. Distinguish provider-reported revision information from information the provider does not expose.

## Benchmark and responsibilities

Use five development cases for the initial connection/schema smoke, then compare both candidates on the existing 20-item development split using the same prompt and eligible sources. Cover clean copy, supported and unsupported claims, expired/conflicting sources, subjective tone, injected instructions, malformed/truncated output and Unicode locations. Surya records precision/recall, citation validity/support, edit fidelity, incomplete rate, latency and cost; Sanath implements the adapter; Darshilkumar displays processing mode and model failures. Keep the 40 held-out items untouched until selection is frozen.

Retain the verification plan's targets: ≥85% precision, ≥80% recall, 100% resolvable citations and ≥90% human-supported citations, with actual sample counts. No measured result exists yet. A five-case smoke cannot establish those targets. Evaluate the fallback separately and record its limitations; a successful primary-model evaluation does not validate it. If neither meets the targets, narrow automated scope and disclose manual review rather than advertising reliable semantic coverage.

Add these assertions to existing cases T08/T15/T20/T23/T25/T26 during implementation: provider/model metadata captured; 429/timeouts bounded; fallback denied when outside approved policy; truncated output fails visibly; over-budget content reports incomplete coverage; API key absent from browser/logs; UI handles provider unavailable; cost/latency measured for both candidates. No product test is marked passed by this document.

## Costs and deployment boundary

Illustrative arithmetic from the supplied catalogue, without caching: at 6,000 input and 512 output tokens, the 235B candidate costs approximately **$0.0015072 per call** ($0.20/M input, $0.60/M output), and the 30B candidate approximately **$0.0007536 per call** ($0.10/M input, $0.30/M output). One thousand such calls would be about $1.51 or $0.75 respectively. These are snapshot estimates, not verified current provider quotes or an assurance that purchased credits cover the usage. Retries, chunks and other provider charges increase totals; dedicated hosting may have separate charges. Track real token usage and enforce an account-approved daily cap.

`models.txt` explicitly labels shared public endpoints suitable for testing and says their availability/processing region may change. A catalogue heading about dedicated endpoints does not prove that the team has one running. Use the purchased hosted access for synthetic development/evaluation; before deploying judge access, verify the actual endpoint permits the intended demo workload and record its availability/privacy limitations. Do not represent a shared demo as a production confidential-data deployment. Confirm stable region, retention/training terms and data controls before accepting confidential material.

This changes the Round 1 preference for a locally hosted model: Round 2 now plans a hosted candidate using existing purchased access, eliminating local GPU provisioning from the critical path. Local deterministic processing stays the default until external provider policy is enabled. Before external analysis, disclose what leaves the deployment and obtain workspace-admin opt-in; this is an application control from the original proposal, not a request for the team to purchase another service.

Configuration names to add during implementation: `MODEL_PROVIDER`, `MODEL_BASE_URL`, `MODEL_PRIMARY_ID`, optional `MODEL_FALLBACK_ID`, `MODEL_API_KEY`, `MODEL_TIMEOUT_SECONDS`, `MODEL_MAX_INPUT_TOKENS`, `MODEL_MAX_OUTPUT_TOKENS`, and `MODEL_DAILY_BUDGET_USD`. Use exact console/API values for IDs. Make fallback disabled by default. Do not create a pretend working endpoint in `.env.example`.

Provider reference: [Nebius API introduction](https://docs.tokenfactory.nebius.com/api-reference/introduction), checked 23 October 2026, documents the OpenAI-compatible base URL and environment-key pattern. `.env.example` records only non-secret configuration placeholders; the S3 adapter is not implemented by S2.
