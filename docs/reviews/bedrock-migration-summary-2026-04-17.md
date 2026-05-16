# Architecture Review Summary: Bedrock Monitoring Migration

**Date**: 2026-04-17
**Branch**: main (uncommitted changes)
**Changes**: 7 files changed, +191/-209
**Reviewers**: Gemini 0.38.1, Kiro-CLI 1.28.3, Claude (earlier kiro-review)
**Phase**: Continuous

---

## Scope

Migration of Bedrock usage monitoring from CloudWatch `AWS/Bedrock` namespace (account-wide) to DynamoDB `cc-on-bedrock-usage` table (project-scoped via IAM role prefix filtering).

**Files changed:**
- `shared/nextjs-app/src/lib/cloudwatch-client.ts` — Removed 150+ lines of Bedrock CloudWatch queries
- `shared/nextjs-app/src/lib/usage-client.ts` — Added `BedrockUsageSnapshot`, `BedrockUsageTimeSeries`
- `shared/nextjs-app/src/app/api/container-metrics/route.ts` — Switched imports to usage-client
- `shared/nextjs-app/src/app/monitoring/monitoring-dashboard.tsx` — Updated UI labels and data shapes
- `shared/nextjs-app/CLAUDE.md` — Documentation updates
- `CHANGELOG.md`, `docs/architecture.md` — Minor updates

---

## Consolidated Findings

| # | Source | Severity | Category | Finding | Recommendation |
|---|--------|----------|----------|---------|----------------|
| 1 | Gemini | **CRITICAL** | Performance | `ScanCommand` for global metrics will bottleneck at 4K users. DynamoDB charges for all scanned items, not just filtered results. | Add GSI with `GSI_PK="PROJECT"` + date SK, or query `DEPT#` partitions instead of scanning `USER#` records. |
| 2 | Gemini | **HIGH** | Code Quality | `MAX_PAGES=100` silently truncates results beyond ~100MB. Dashboard metrics would show incorrect totals with no error. | Add logging/warning when truncation occurs; long-term, eliminate Scan. |
| 3 | Kiro/Claude | **MEDIUM** | Security | `days` and `hours` query params in container-metrics route are unbounded. Malicious admin could trigger expensive DynamoDB scans. | Clamp: `days` to [1, 90], `hours` to [1, 168]. |
| 4 | Gemini | **MEDIUM** | Consistency | Lambda `bedrock-usage-tracker.py` does two separate `update_item` calls (USER# + DEPT#). Failure between them causes desync. | Use `transact_write_items` for atomicity. |
| 5 | Gemini | **MEDIUM** | Architecture | No global aggregate partition — every dashboard load re-aggregates from individual records. | Introduce `GLOBAL#ALL` partition or pre-computed daily rollups. |
| 6 | Kiro/Claude | **LOW** | UX | `hoursElapsed` uses UTC midnight — misleading for KST (UTC+9) users early in the UTC day. | Document UTC basis in UI or adjust to user timezone. |

---

## Positive Findings (All Reviewers)

- **Per-project tracking**: Correctly isolates cc-on-bedrock usage from other account activity
- **Atomic aggregation**: Lambda uses DynamoDB `ADD` expressions preventing race conditions
- **Admin access enforcement**: `session?.user?.isAdmin` check on all metrics endpoints
- **Data privacy**: `textDataDeliveryEnabled: false` prevents prompt/response text logging
- **Dead code cleanup**: Clean removal of unused CloudWatch Bedrock functions
- **Type safety**: Strong TypeScript interfaces for all data shapes

---

## Overall Risk: **MEDIUM-HIGH**

| Verdict | Rationale |
|---------|-----------|
| **REVIEW** | 1 CRITICAL (Scan scaling) + 1 HIGH (silent truncation) require attention before 4K user target. Current user count is low enough that these don't block deployment, but must be addressed in the scaling roadmap. |

---

## Action Items

### Immediate (this PR)
- [x] Clamp `days` param to [1, 90] and `hours` to [1, 168] in container-metrics route

### Short-term (next sprint)
- [ ] Add warning log when `MAX_PAGES` truncation occurs in `getUsageRecords`
- [ ] Use `transact_write_items` in `bedrock-usage-tracker.py` Lambda

### Pre-scale (before 4K users)
- [ ] Add GSI (`GSI_PK="PROJECT"`, SK=date) for efficient date-range queries
- [ ] Introduce `GLOBAL#ALL` daily rollup partition or query DEPT# partitions
- [ ] Evaluate ElastiCache for IAM/Cognito lookups in Lambda

---

## Detailed Reviews

- [Gemini Review](gemini.md) — Thorough 5-section analysis: architecture, security, performance, cost, code quality
- [Kiro Review](kiro.md) — Truncated (raw diff output consumed buffer before synthesis)
- [Claude kiro-review](../decisions/) — 2 MEDIUM + 2 LOW findings from earlier session
