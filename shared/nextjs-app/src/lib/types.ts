// ─── Auth & User Types ───

export interface UserSession {
  id: string;
  email: string;
  name?: string;
  groups: string[];
  isAdmin: boolean;
  subdomain?: string;
  containerOs?: "ubuntu" | "al2023";
  resourceTier?: "light" | "standard" | "power";
  securityPolicy?: "open" | "restricted" | "locked";
  litellmApiKey?: string;
  containerId?: string;
  storageType?: "ebs" | "efs";
}

export interface CognitoUser {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  createdAt: string;
  subdomain: string;
  department: string;
  containerOs: "ubuntu" | "al2023";
  resourceTier: "light" | "standard" | "power";
  securityPolicy: "open" | "restricted" | "locked";
  storageType?: "ebs" | "efs";
  litellmApiKey?: string;
  containerId?: string;
  groups: string[];
}

export interface CreateUserInput {
  email: string;
  subdomain: string;
  department: string;
  containerOs: "ubuntu" | "al2023";
  resourceTier: "light" | "standard" | "power";
  securityPolicy: "open" | "restricted" | "locked";
  storageType: "ebs" | "efs";
}

export interface UpdateUserInput {
  username: string;
  containerOs?: "ubuntu" | "al2023";
  resourceTier?: "light" | "standard" | "power";
  securityPolicy?: "open" | "restricted" | "locked";
  storageType?: "ebs" | "efs";
}

// ─── Usage Analytics Types ───

export interface SpendLog {
  request_id: string;
  api_key: string;
  model: string;
  call_type: string;
  spend: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  startTime: string;
  endTime: string;
  user: string;
  status: string;
}

export interface ModelMetrics {
  model: string;
  num_requests: number;
  total_tokens: number;
  avg_latency_seconds: number;
  total_spend: number;
}

export interface SpendSummary {
  date: string;
  spend: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface SystemHealth {
  status: string;
  db: string;
  cache: string;
  architecture: string;
  version?: string;
  model_count?: number;
}

// ─── ECS / Container Types ───

export interface ContainerInfo {
  taskArn: string;
  taskId: string;
  status: string;
  desiredStatus: string;
  username: string;
  subdomain: string;
  containerOs: "ubuntu" | "al2023";
  resourceTier: "light" | "standard" | "power";
  securityPolicy: "open" | "restricted" | "locked";
  cpu: string;
  memory: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
  healthStatus?: string;
  privateIp?: string;
  storageType?: "ebs" | "efs";
}

export interface StartContainerInput {
  username: string;
  subdomain: string;
  department: string;
  containerOs: "ubuntu" | "al2023";
  resourceTier: "light" | "standard" | "power";
  securityPolicy: "open" | "restricted" | "locked";
  storageType?: "ebs" | "efs";
}

// ─── Usage Tracking Types (CloudTrail → DynamoDB) ───

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
}

export interface DepartmentUsage {
  department: string;
  users: number;
  totalTokens: number;
  totalCost: number;
  requests: number;
}

// ─── Department Dashboard Types ───

export interface DeptMember {
  username: string;
  email: string;
  subdomain: string;
  containerOs: string;
  resourceTier: string;
  status: string;
  containerStatus?: string;
}

export interface DeptBudget {
  department: string;
  monthlyBudget: number;
  currentSpend: number;
  monthlyTokenLimit: number;
  currentTokens: number;
}

export interface PendingRequest {
  requestId: string;
  email: string;
  subdomain: string;
  containerOs: string;
  resourceTier: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  department: string;
}

export interface MonthlyUsage {
  date: string;
  cost: number;
  tokens: number;
}

export interface DepartmentListItem {
  department: string;
  memberCount: number;
  totalCost: number;
  totalTokens: number;
  requests: number;
  budgetUtilization: number;
  monthlyBudget: number;
  pendingCount: number;
}

export interface UserUsage {
  userId: string;
  department: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requests: number;
  lastActive: string;
}

export interface StopContainerInput {
  taskArn: string;
  reason?: string;
}

// ─── Dashboard / Chart Types ───

export interface TokenUsageData {
  date: string;
  promptTokens: number;
  completionTokens: number;
}

export interface ModelRatioData {
  name: string;
  value: number;
}

export interface CostTrendData {
  date: string;
  cost: number;
}

export interface StatCardData {
  title: string;
  value: string | number;
  description?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export interface HealthStatus {
  service: string;
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  lastChecked: string;
  details?: Record<string, unknown>;
}

// ─── API Response Types ───

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}
