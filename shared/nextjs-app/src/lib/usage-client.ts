/**
 * Usage Tracking Client — DynamoDB-based usage analytics
 * Reads from DynamoDB cc-on-bedrock-usage table
 * Data source: Bedrock Invocation Logging → Lambda → DynamoDB
 */
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION ?? "ap-northeast-2";
const TABLE_NAME = process.env.USAGE_TABLE_NAME ?? "cc-on-bedrock-usage";

const dynamodb = new DynamoDBClient({ region });

// ─── Types ───

export interface UsageRecord {
  userId: string;
  department: string;
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  estimatedCost: number;
  latencySumMs: number;
}

export interface UserUsageSummary {
  userId: string;
  department: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requests: number;
  models: string[];
}

export interface DepartmentSummary {
  department: string;
  totalTokens: number;
  totalCost: number;
  requests: number;
  userCount: number;
}

export interface ModelSummary {
  model: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requests: number;
  avgLatencyMs: number;
}

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  estimatedCost: number;
}

// ─── Internal: parse DynamoDB item to UsageRecord ───

function toUsageRecord(item: Record<string, AttributeValue>): UsageRecord {
  const u = unmarshall(item);
  return {
    userId: (u.PK as string).replace("USER#", ""),
    department: u.department ?? "default",
    date: u.date ?? (u.SK as string).split("#")[0],
    model: u.model ?? (u.SK as string).split("#")[1] ?? "unknown",
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    totalTokens: u.totalTokens ?? 0,
    requests: u.requests ?? 0,
    estimatedCost: Number(u.estimatedCost ?? 0),
    latencySumMs: Number(u.latencySumMs ?? 0),
  };
}

// ─── Query Functions ───

async function queryByUser(userId: string, startDate?: string, endDate?: string): Promise<UsageRecord[]> {
  const keyCondition = startDate || endDate
    ? "PK = :pk AND #d BETWEEN :start AND :end"
    : "PK = :pk";

  const exprValues: Record<string, AttributeValue> = {
    ":pk": { S: `USER#${userId}` },
  };
  if (startDate || endDate) {
    exprValues[":start"] = { S: startDate ?? "2020-01-01" };
    exprValues[":end"] = { S: endDate ?? "2099-12-31" };
  }

  const items: Record<string, AttributeValue>[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;

  do {
    const result = await dynamodb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "user-date-index",
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: exprValues,
      ...(startDate || endDate ? { ExpressionAttributeNames: { "#d": "date" } } : {}),
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items.map(toUsageRecord);
}

async function queryByDepartment(department: string, startDate?: string, endDate?: string): Promise<UsageRecord[]> {
  const keyCondition = startDate || endDate
    ? "department = :dept AND #d BETWEEN :start AND :end"
    : "department = :dept";

  const exprValues: Record<string, AttributeValue> = {
    ":dept": { S: department },
  };
  if (startDate || endDate) {
    exprValues[":start"] = { S: startDate ?? "2020-01-01" };
    exprValues[":end"] = { S: endDate ?? "2099-12-31" };
  }

  const items: Record<string, AttributeValue>[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;

  do {
    const result = await dynamodb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "department-date-index",
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: exprValues,
      ...(startDate || endDate ? { ExpressionAttributeNames: { "#d": "date" } } : {}),
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items.map(toUsageRecord);
}

async function scanAllRecords(startDate?: string, endDate?: string): Promise<UsageRecord[]> {
  const filterParts: string[] = ["begins_with(PK, :userPrefix)"];
  const exprValues: Record<string, AttributeValue> = {
    ":userPrefix": { S: "USER#" },
  };

  if (startDate) {
    filterParts.push("#d >= :startDate");
    exprValues[":startDate"] = { S: startDate };
  }
  if (endDate) {
    filterParts.push("#d <= :endDate");
    exprValues[":endDate"] = { S: endDate };
  }

  const needsDateAlias = startDate || endDate;
  const items: Record<string, AttributeValue>[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;

  do {
    const result = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: filterParts.join(" AND "),
      ExpressionAttributeValues: exprValues,
      ...(needsDateAlias ? { ExpressionAttributeNames: { "#d": "date" } } : {}),
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(result.Items ?? []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items.map(toUsageRecord);
}

export async function getUsageRecords(params?: {
  startDate?: string;
  endDate?: string;
  userId?: string;
  department?: string;
}): Promise<UsageRecord[]> {
  // Route to the most efficient query path
  if (params?.userId) {
    return queryByUser(params.userId, params?.startDate, params?.endDate);
  }
  if (params?.department) {
    return queryByDepartment(params.department, params?.startDate, params?.endDate);
  }
  // Fallback: full scan (admin totals only)
  return scanAllRecords(params?.startDate, params?.endDate);
}

export async function getUserSummaries(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<UserUsageSummary[]> {
  const records = await getUsageRecords(params);

  const userMap = new Map<string, UserUsageSummary>();
  for (const r of records) {
    const existing = userMap.get(r.userId) ?? {
      userId: r.userId,
      department: r.department,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      requests: 0,
      models: [],
    };
    existing.totalTokens += r.totalTokens;
    existing.inputTokens += r.inputTokens;
    existing.outputTokens += r.outputTokens;
    existing.totalCost += r.estimatedCost;
    existing.requests += r.requests;
    if (!existing.models.includes(r.model)) existing.models.push(r.model);
    userMap.set(r.userId, existing);
  }

  return Array.from(userMap.values()).sort((a, b) => b.totalCost - a.totalCost);
}

export async function getDepartmentSummaries(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<DepartmentSummary[]> {
  const records = await getUsageRecords(params);

  const deptMap = new Map<string, DepartmentSummary & { users: Set<string> }>();
  for (const r of records) {
    const existing = deptMap.get(r.department) ?? {
      department: r.department,
      totalTokens: 0,
      totalCost: 0,
      requests: 0,
      userCount: 0,
      users: new Set<string>(),
    };
    existing.totalTokens += r.totalTokens;
    existing.totalCost += r.estimatedCost;
    existing.requests += r.requests;
    existing.users.add(r.userId);
    existing.userCount = existing.users.size;
    deptMap.set(r.department, existing);
  }

  return Array.from(deptMap.values())
    .map(({ users, ...rest }) => rest)
    .sort((a, b) => b.totalCost - a.totalCost);
}

export async function getModelSummaries(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<ModelSummary[]> {
  const records = await getUsageRecords(params);

  const modelMap = new Map<string, ModelSummary & { latencySum: number }>();
  for (const r of records) {
    const existing = modelMap.get(r.model) ?? {
      model: r.model,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      requests: 0,
      avgLatencyMs: 0,
      latencySum: 0,
    };
    existing.totalTokens += r.totalTokens;
    existing.inputTokens += r.inputTokens;
    existing.outputTokens += r.outputTokens;
    existing.totalCost += r.estimatedCost;
    existing.requests += r.requests;
    existing.latencySum += r.latencySumMs;
    modelMap.set(r.model, existing);
  }

  return Array.from(modelMap.values())
    .map(({ latencySum, ...rest }) => ({
      ...rest,
      avgLatencyMs: rest.requests > 0 ? Math.round(latencySum / rest.requests) : 0,
    }))
    .sort((a, b) => b.requests - a.requests);
}

export async function getDailyUsage(params?: {
  startDate?: string;
  endDate?: string;
  userId?: string;
}): Promise<DailyUsage[]> {
  const records = await getUsageRecords(params);

  const dateMap = new Map<string, DailyUsage>();
  for (const r of records) {
    const existing = dateMap.get(r.date) ?? {
      date: r.date,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requests: 0,
      estimatedCost: 0,
    };
    existing.inputTokens += r.inputTokens;
    existing.outputTokens += r.outputTokens;
    existing.totalTokens += r.totalTokens;
    existing.requests += r.requests;
    existing.estimatedCost += r.estimatedCost;
    dateMap.set(r.date, existing);
  }

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Total Spend ───

export async function getTotalUsage(): Promise<{
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  userCount: number;
}> {
  const records = await getUsageRecords();
  const users = new Set(records.map((r) => r.userId));

  return {
    totalCost: records.reduce((s, r) => s + r.estimatedCost, 0),
    totalTokens: records.reduce((s, r) => s + r.totalTokens, 0),
    totalRequests: records.reduce((s, r) => s + r.requests, 0),
    userCount: users.size,
  };
}
