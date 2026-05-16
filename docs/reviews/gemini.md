YOLO mode is enabled. All tool calls will be automatically approved.
YOLO mode is enabled. All tool calls will be automatically approved.
I will start by checking the uncommitted changes to understand the scope and nature of the migration and any other modifications.
I will list the files in the `agent` and `cdk/lib` directories to identify the core components of the usage tracking system.
I will also list the contents of the `agent/lambda` directory to find any Lambda functions related to usage tracking.
I will now list the files in the `cdk/lib` directory to understand how the usage tracking infrastructure is defined.
I will examine the uncommitted changes in `cdk/lib/03-usage-tracking-stack.ts` to understand the architectural shift from CloudWatch to DynamoDB for usage tracking.
I will run `git status` to see which files have uncommitted changes and determine the scope of my review.
I will check the diff for `shared/nextjs-app/src/lib/usage-client.ts` to see how usage data is now being retrieved and whether it aligns with the migration to DynamoDB.
I will read the beginning of `shared/nextjs-app/src/lib/usage-client.ts` to see how `getUsageRecords` and `getDailyUsage` are implemented and where they get their data from.
I will now examine the changes in `shared/nextjs-app/src/app/api/container-metrics/route.ts` to see if there are any related security or architectural issues.
I will read more of `shared/nextjs-app/src/lib/usage-client.ts` starting from line 151 to understand the implementation of the `ScanCommand` and whether there are any optimizations for department-based queries.
I will examine the DynamoDB table definition in `cdk/lib/03-usage-tracking-stack.ts` to see if there are any Global Secondary Indices (GSIs) that could optimize date-based queries and address the performance concerns with `ScanCommand`.
I will check the implementation of the `usage-tracker` Lambda function, specifically looking at the `bedrock-usage-tracker.py` file in the `cdk/lib/lambda` directory, to understand how it writes usage data to DynamoDB.
I will read `cdk/lib/lambda/bedrock-usage-tracker.py` to understand how usage data is processed and stored in DynamoDB.
I will examine the changes in `shared/nextjs-app/src/lib/cloudwatch-client.ts` to see how it has been modified during the migration and if there are any remaining dependencies on CloudWatch for Bedrock metrics.
I will examine the session and authorization checks in `shared/nextjs-app/src/app/api/container-metrics/route.ts` to see if there are any security risks related to data exposure.
I will read `shared/nextjs-app/src/app/monitoring/monitoring-dashboard.tsx` to see how the dashboard is implemented and how it uses the metrics data.
I will check the diff for `docs/architecture.md` to see if the architectural changes are properly documented and if there are any further insights into the migration.
I will read the untracked `shared/nextjs-app/DESIGN.md` file to see if it contains any relevant design decisions or information about the usage tracking migration.
I will read the remaining part of `shared/nextjs-app/src/lib/usage-client.ts` starting from line 301 to check the implementation of `getTotalUsage` and other remaining functions.
I will check the diff for `CHANGELOG.md` and `CLAUDE.md` to see if there are any other important changes or updates I should be aware of.
This code review focuses on the architectural shift from CloudWatch metrics to DynamoDB-based usage tracking, security in the dashboard API, performance at scale (4000+ users), and code quality of the recent changes.

## Architectural Review: CC-on-Bedrock Usage Tracking Migration

### 1. Architecture Soundness
*   **Per-Project Tracking (Positive)**: Moving from `AWS/Bedrock` CloudWatch metrics to a custom DynamoDB pipeline is a significant improvement. CloudWatch metrics are account-wide, making it impossible to distinguish `cc-on-bedrock` usage from other projects in the same AWS account. The new pipeline correctly filters by IAM role prefix (`cc-on-bedrock-task-*`).
*   **Atomic Aggregation (Positive)**: The `bedrock-usage-tracker.py` Lambda uses DynamoDB `ADD` expressions in `UpdateItem`, ensuring atomic increments and preventing race conditions during concurrent invocations.
*   **Dual-Source Reliability (Positive)**: Using both Bedrock Invocation Logging (for token counts) and CloudTrail (as a fallback/request counter) provides robust data collection.
*   **Sync Risk (Medium)**: `bedrock-usage-tracker.py` performs two separate `update_item` calls (one for `USER#` and one for `DEPT#`). If the Lambda fails or is throttled between these calls, the user and department totals will become out of sync. 
    *   *Recommendation*: Wrap these in a `transact_write_items` call to ensure both or neither are updated.

### 2. Security
*   **Admin Access Enforcement (Positive)**: `shared/nextjs-app/src/app/api/container-metrics/route.ts` correctly verifies `session?.user?.isAdmin` before processing any metrics requests.
*   **Data Privacy (Positive)**: Setting `textDataDeliveryEnabled: false` in the Bedrock logging configuration (via CDK) is a critical security and cost-saving measure. It prevents logging full prompt/response text while still allowing metadata (tokens, model, identity) to be tracked.
*   **Input Validation (Medium)**: While the API is restricted to admins, the `getUsageRecords` function in `usage-client.ts` accepts `userId` and `department` parameters that are directly used in DynamoDB expressions. 
    *   *Recommendation*: Ensure strict validation of these parameters to prevent potential NoSQL injection or unauthorized data traversal.

### 3. Performance & Scaling
*   **Inefficient Scan Pattern (Critical)**: `shared/nextjs-app/src/lib/usage-client.ts` relies on `ScanCommand` for project-wide summaries (when `userId` is not provided). 
    *   **Scale Risk**: With the target of 4000 users, a full table scan will quickly become a performance bottleneck and a cost driver. Even with a `FilterExpression`, DynamoDB charges for the total number of items scanned, not just those returned.
    *   **Truncation Risk**: `MAX_PAGES = 100` in `usage-client.ts` will silently truncate results once the table grows beyond ~100MB. This will lead to incorrect dashboard metrics (e.g., "Total Tokens" showing a lower-than-actual value) without any error or warning.
    *   *Recommendation*: Implement a `GLOBAL#ALL` partition or query the `DEPT#` partitions instead of scanning all `USER#` records. The dashboard currently aggregates user records in JavaScript, which is highly inefficient at scale.

### 4. Cost Optimization
*   **CloudWatch Savings (Positive)**: Removing `GetMetricData` calls and disabling full-text logging significantly reduces CloudWatch costs.
*   **DynamoDB Cost (High)**: The linear growth of `Scan` costs as history accumulates will eventually offset the CloudWatch savings. 
    *   *Recommendation*: Add a Global Secondary Index (GSI) with a constant partition key (e.g., `GSI_PK = "PROJECT"`) and `date` as the sort key to allow efficient, paginated queries of daily aggregates.

### 5. Code Quality
*   **Dead Code Cleanup (Positive)**: The removal of unused Bedrock metric functions from `cloudwatch-client.ts` keeps the codebase clean.
*   **Type Safety (Positive)**: Good use of TypeScript interfaces for usage records and snapshots ensures consistency between the backend client and the frontend dashboard.
*   **In-Memory Caching (Low)**: `bedrock-usage-tracker.py` uses simple dictionary caches for IAM and Cognito lookups. While effective for a single Lambda execution, these are lost on cold starts.
    *   *Recommendation*: For 4000 users, consider a short-lived cache in ElastiCache or increase the Lambda's provisioned concurrency to maintain warm instances.

---

## Summary of Findings

| ID | Finding | Severity | Category |
|:---|:---|:---|:---|
| 01 | **Inefficient Scan for Global Metrics** | **Critical** | Performance |
| 02 | **Silent Data Truncation (`MAX_PAGES`)** | **High** | Code Quality |
| 03 | **Potential User/Dept Data Desync** | **Medium** | Consistency |
| 04 | **Lack of Global Aggregate Partition** | **Medium** | Architecture |

### Priority Action Items:
1.  **Refactor `getUsageRecords`**: Replace the `ScanCommand` for project-wide summaries with a GSI-based `QueryCommand`.
2.  **Use Department Aggregates**: Update the dashboard client to fetch pre-aggregated `DEPT#` records instead of summing individual `USER#` records in the browser.
3.  **Atomic Transactions**: Use `transact_write_items` in the usage tracker Lambda to keep user and department data perfectly in sync.
