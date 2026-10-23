# BrandGuard — Judge Walkthrough & Evaluation Guide

**Project:** BrandGuard (CODE CATALYST — Round 2)  
**System:** Pre-Publication Brand Governance & Compliance Review Desk  
**Authors:** Sanath Reddy (Lead, Backend/DB), Darshilkumar Patel (Frontend/Workflow), Surya (Engines/Runtime/Infra)  
**Date:** 23 October 2026  
**Primary Deliverables:** Web Application (`apps/web`), REST API (`apps/api`), Review Engine (`packages/review_engine`), Worker Daemon (`apps/worker`), E2E Verification Suites (`tests/e2e`).

---

## 1. Quick Start for Judges

BrandGuard can be experienced in two modes:

### Mode A: Full Containerised Deployment (Recommended)
```bash
# 1. Start all 4 microservices (Postgres 16, FastAPI, Worker Daemon, React SPA + Caddy)
docker compose -f infra/compose.yaml up -d

# 2. Run automated database migrations & seed canonical LumaDesk demo data
docker compose -f infra/compose.yaml exec api alembic upgrade head
docker compose -f infra/compose.yaml exec api python -m apps.api.seed

# 3. Open browser
http://localhost:3000
```

### Mode B: Lightweight Standalone Web Demonstration (Zero external dependencies)
```bash
# 1. Install dependencies and start Vite dev server with high-fidelity Mock Transport
cd apps/web
npm install
npm run dev

# 2. Open browser
http://localhost:5173
```
*(The React application includes a complete, stateful in-memory transport faithfully simulating all 22 REST endpoints, session cookies, CSRF tokens, concurrency version checks, and finding resolutions).*

---

## 2. Seeded User Identities & Role Matrix

BrandGuard enforces strict role separation. You can test each role using 1-click Quick Login buttons on the `/login` screen:

| Role | Email | Password | Permissions & Workflow Purpose |
|---|---|---|---|
| **Compliance Manager** | `manager@lumadesk.test` | `Manager123!` | Activates guideline sources, enforces processing mode policies, inspects brand governance metrics, reviews ambiguity reports. |
| **Content Creator** | `creator@lumadesk.test` | `Creator123!` | Drafts campaigns, uploads copy, runs analysis, applies suggested edits, submits revisions for review. *Cannot approve own work.* |
| **Brand Reviewer** | `reviewer@lumadesk.test` | `Reviewer123!` | Triages review queue, inspects grounded evidence, grants/denies exceptions, records official approval or changes request. |

---

## 3. Step-by-Step 10-Minute Walkthrough Journey

Follow this guided tour to experience the complete pre-publication compliance lifecycle:

### Step 1: Authentication & Role Gate
1. Navigate to `/login`.
2. Notice the security posture: Memory-hard Argon2id password hashing, HTTP-only session cookie isolation, and CSRF protection headers.
3. Click the **"Quick Login as Creator"** button.
4. You are redirected to `/brands/brand-lumadesk-001`, the active workspace.

![Login & Authentication](screenshots/01_login_and_auth.png)

---

### Step 2: Guideline & Source Management
1. Click **"Brand Guidelines"** in the top navigation.
2. Inspect the active source documents:
   - `LumaDesk Brand Voice & Facts v1` (Active, Source Epoch #1, SHA-256 verified).
   - 12 active rules categorized by `terminology`, `facts_claims`, `typography`, and `visual_contrast`.
3. Click **"Processing Mode Policy"**:
   - Inspect the dual-lock disclosure: Default is **Local Deterministic Only** (0.2ms latency, 100% data privacy).
   - Administrators can optionally enable external inference with model provider disclosures.
4. Click **"Report Guideline Ambiguity"**:
   - Try entering fewer than 20 characters — notice the form validation error.
   - Enter a 20+ character explanation of conflicting guidelines to record an audit notice.

![Brand Guidelines & Sources](screenshots/02_brand_sources_and_guidelines.png)

---

### Step 3: Campaign Intake & Content Ingestion
1. Click **"Create Campaign"** or **"New Campaign Intake"**.
2. Select or enter campaign metadata:
   - **Title**: `LumaDesk Pro Q4 Launch Promo`
   - **Target Channel**: `social_post` (or `blog`, `press_release`, `ad_copy`)
   - **Target Audience**: `b2b_decision_makers`
   - **Campaign Purpose**: `conversion`
3. Click the **"Load Fictional LumaDesk Example Copy"** button. This injects typical draft copy containing real-world compliance traps:
   - Improper brand capitalization (`Lumadesk` instead of `LumaDesk`).
   - Unsubstantiated free-trial claim (`30-day trial` instead of the approved `14-day trial`).
   - Missing required disclaimer for enterprise plans.
4. Review the **Data Processing Disclosure** card before submission.
5. Click **"Analyse Campaign Copy"**.

![Content Intake Screen](screenshots/03_content_intake_and_processing_mode.png)

---

### Step 4: Compliance Findings & Located Evidence Drawer
1. The campaign workspace opens at `/content/cnt-001`.
2. Notice the **Summary Header**:
   - Current Status: `needs_changes` (Yellow badge).
   - Blocker Count: `2 Blockers` (Prevents publication / export).
   - Engine Version: Deterministic local engine with verified rule IDs.
3. In the document preview pane, observe **Interactive Annotation Markers**:
   - High-contrast highlighted text spans positioned exactly at Unicode code points.
   - Click the marker on `"Lumadesk"`. Focus smoothly scrolls and highlights the finding card in the right rail.
4. On the finding card, click **"View Evidence & Source Quote"**:
   - The slide-over **Evidence Drawer** displays the authoritative rule definition, source version, and exact quoted guideline:
     > *"LumaDesk must always be written with a capital 'L' and capital 'D' with no space between words."*
   - Grounding status: `✓ Verified Grounded Violation`.

![Compliance Findings & Evidence](screenshots/04_campaign_workspace_and_findings.png)

---

### Step 5: Revision Diff & 1-Click Suggestion Application
1. On Finding #1 (`Lumadesk` capitalization):
   - Click **"Quick Apply Suggestion"** (`LumaDesk`).
   - The text in the editor updates instantaneously.
2. On Finding #2 (`30-day free trial` claim):
   - Click **"Inspect & Apply"**.
   - Modify or accept the suggested replacement: `14-day free trial`.
   - Click **"Apply Replacement"**.
3. Toggle the **Diff Viewer** between:
   - **Unified Inline Diff**: Highlights deletions (`<del>`) in red and additions (`<ins>`) in green.
   - **Side-by-Side Split Diff**: Shows exact before-and-after comparison with token-level LCS accuracy.
4. Click **"Save New Revision #2"**.
   - Re-analysis runs automatically.
   - Finding count drops to **0 Blockers**. Status transitions to `ready_for_review`!

---

### Step 6: Collaborative Discussion & Reviewer Assignment
1. Scroll down to the **Discussion & Audit Log** section.
2. Enter a comment: `"Fixed terminology and trial length per Brand Voice v1 rules."`
3. Click **"Post Comment"** (`POST /api/v1/revisions/:id/comments`).
4. Click **"Submit Revision for Review"**:
   - Select authorized reviewer: `reviewer@lumadesk.test`.
   - Notice the modal validates `content.workflow_version` to guarantee concurrency safety.
   - Click **"Submit for Review"**. Status transitions to `in_review`.

---

### Step 7: Reviewer Queue & Independent Approval
1. Click **"Sign Out"** and log in as **Reviewer** (`reviewer@lumadesk.test`).
2. On the Home Page, inspect the **Review Queue**:
   - Filter tabs: `All`, `In Review` (1), `Changes Requested`, `Approved`, `Drafts`.
   - The campaign `LumaDesk Pro Q4 Launch Promo` appears with badge `IN REVIEW`.
3. Click **"Open Review Workspace"**.
4. Notice that because you are a different user than the creator (`reviewer@lumadesk.test` vs `creator@lumadesk.test`), the **Reviewer Decision Actions** are fully unlocked:
   - **"✓ Approve Exact Revision"** (Green).
   - **"⟲ Request Changes"** (Amber).
5. Click **"✓ Approve Exact Revision"**:
   - Type an audit rationale of at least 20 characters:
     `"All blockers verified resolved. Terminology and trial length match Brand Voice v1."`
   - Notice the live counter: `82 / 20 characters minimum`.
   - Click **"✓ Confirm Approval"**.
   - Campaign state immediately transitions to `approved` (Green badge).

![Review Queue](screenshots/05_human_review_queue.png)

---

### Step 8: Tamper-Proof Cryptographic Export
1. With the campaign approved, the **"Export Approved Copy"** button is active.
2. Click **"Export Approved Copy"**:
   - View the verified copy alongside its cryptographic SHA-256 text hash:
     `sha256:4f8a...`
   - Approver attribution: `reviewer@lumadesk.test` with exact UTC timestamp.
   - Source Epoch: Bound to Source Epoch #1 (tamper-evident seal).
3. Click **"Download Signed Certificate"** to save the machine-readable JSON compliance certificate (`GET /api/v1/revisions/:id/export`).

---

### Step 9: Brand Governance Insights & Audit Accounting
1. In the top navigation, click **"Brand Guidelines"** → **"Governance Insights"**.
2. View the deduplicated metrics:
   - **Denominator**: Total reviewed content items.
   - **Violations Confirmed**: Human-verified rule infractions.
   - **Violations Dismissed**: False positives marked as nuances.
   - **Exceptions Granted**: Business exemptions tied to Jira/ticket numbers.
   - **Ambiguous Guidelines Count**: Rules flagged by reviewers for manager clarification.
3. Inspect the **Rule Breakdown Table**:
   - View exact violation rates per reviewed campaign, enabling managers to identify guidelines that cause the most team friction.

![Governance Insights Modal](screenshots/06_governance_insights_and_audit.png)

---

### Step 10: Guided Demo Sandbox
1. From any screen, click **"Guided Demo"** in the top navigation bar (`/demo`).
2. The interactive sandbox presents the complete LumaDesk scenario with a 1-click reset, pre-loaded sample copy, and visual explanations of every compliance gate.

![Guided Demo Page](screenshots/07_lumadesk_guided_demo.png)

---

## 4. Accessibility & Responsive Verification

BrandGuard was built to exceed WCAG 2.2 AA accessibility standards:
- **Full Keyboard Operability**:
  - `Tab` / `Shift+Tab`: Clean, logical tab flow through all interactive elements.
  - `Escape`: Instantly dismisses all modals and the slide-over evidence drawer, returning focus to the triggering button.
  - `Enter` / `Space`: Activates buttons, tabs, and finding markers.
- **Screen Reader Support**:
  - Live announcements (`aria-live="polite"`) when findings change or re-analysis finishes.
  - Modals feature `role="dialog"`, `aria-modal="true"`, and explicit `aria-labelledby` headers.
- **Visual Contrast & Reflow**:
  - 100% of text meets the 4.5:1 contrast ratio against background surfaces.
  - Zooming to 200% reflows the workspace into a single readable column without horizontal scrolling.

---

## 5. Automated Verification Commands

Judges can independently verify all test suites from the command line:

```bash
# 1. Run Complete E2E & Verification Suite (T11, T16, T17, T26, T30)
node tests/e2e/run_all.mjs
# Expected: ALL 29 CHECKS PASSED (100%)

# 2. Verify Plan & Requirement Mapping Coverage
python scripts/verify_plan.py
# Expected: PASS: 26 requirements mapped to 30 cases.

# 3. Verify Production Frontend Build
cd apps/web && npm run build
# Expected: Clean build with 0 TypeScript errors (tsc -b && vite build)
```
