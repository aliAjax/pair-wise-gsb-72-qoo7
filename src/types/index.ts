export type FlagStatus = 'draft' | 'review' | 'active' | 'frozen' | 'rolled-back'
export type Environment = 'dev' | 'staging' | 'production'
export type RuleOperator = 'equals' | 'not-equals' | 'contains' | 'in' | 'gte' | 'lte'
export type IssueSeverity = 'blocker' | 'warning' | 'info'
export type IssueCategory =
  | 'rule-conflict'
  | 'dead-code'
  | 'missing-metric'
  | 'overlap'
  | 'client-compatibility'

export interface AudienceRule {
  id: string
  attribute: string
  operator: RuleOperator
  value: string
  negate: boolean
}

export interface RolloutStep {
  id: string
  percentage: number
  audience: string
  startedAt: string
  status: 'completed' | 'running' | 'planned' | 'paused'
  guardrails: string[]
}

export interface Dependency {
  flagId: string
  type: 'requires' | 'conflicts' | 'fallback'
  condition: string
}

/** 批准时刻留存的依赖快照项 */
export interface DependencySnapshotEntry {
  flagId: string
  flagKey: string
  type: Dependency['type']
  /** 批准当时目标开关是否启用 */
  enabled: boolean
  /** 批准当时目标开关状态 */
  status: FlagStatus
  capturedAt: string
}

/** 发布负责人审批记录，跟随开关长期留存 */
export interface ApprovalRecord {
  id: string
  reviewer: string
  approvedAt: string
  comment: string
  /** 冻结截止时间（ISO），冻结期内灰度阶段禁止扩量 */
  freezeUntil?: string
  /** 批准当时的依赖快照，后续用于审批失效判定 */
  dependencySnapshot: DependencySnapshotEntry[]
  /** 批准当时发布相关配置的指纹，配置改动后审批立即失效 */
  configHash: string
  invalidated?: boolean
  invalidatedAt?: string
  invalidatedReason?: string
}

export interface FeatureFlag {
  id: string
  key: string
  name: string
  description: string
  owner: string
  team: string
  status: FlagStatus
  environment: Environment
  enabled: boolean
  rolloutPercentage: number
  audienceRules: AudienceRule[]
  regions: string[]
  minClientVersion: Record<Environment, string>
  dependencies: Dependency[]
  rollbackConditions: string[]
  metricNames: string[]
  deadCodeStatus: 'clean' | 'candidate' | 'confirmed'
  rolloutSteps: RolloutStep[]
  /** 当前生效（或已失效）的发布审批记录 */
  approval?: ApprovalRecord
  createdAt: string
  updatedAt: string
  lastChangedBy: string
}

export type AuditAction =
  | 'created'
  | 'updated'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'frozen'
  | 'unfrozen'
  | 'rolled-back'
  | 'rollout-adjusted'
  | 'approval-invalidated'
  | 'metric-added'
  | 'report-archived'

export interface AuditEvent {
  id: string
  flagId: string
  flagKey: string
  action: AuditAction
  actor: string
  summary: string
  before?: string
  after?: string
  affectedUsers: number
  createdAt: string
}

export interface ImpactIssue {
  id: string
  flagId: string
  flagKey: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  detail: string
  suggestion: string
  resolved: boolean
}

/** 一次操作可拆解的写入步骤：多个开关、审计、报告 */
export type OutboxStepType = 'rollback-flag' | 'create-report'

export interface OutboxStep {
  id: string
  type: OutboxStepType
  status: 'pending' | 'done' | 'failed'
  attempts: number
  lastAttemptedAt?: string
  error?: string
  // rollback-flag 参数
  flagId?: string
  actor?: string
  reason?: string
  // create-report 参数
  reportTitle?: string
}

export interface OutboxOperation {
  id: string
  title: string
  createdAt: string
  steps: OutboxStep[]
}

/** 归档的发布操作报告（由 outbox 报告步骤生成） */
export interface ReleaseReport {
  id: string
  title: string
  kind: 'batch-rollback'
  actor: string
  detail: string
  createdAt: string
  items: Array<{ flagId: string; flagKey: string; reason: string }>
}

export interface DashboardData {
  activeFlags: number
  pendingReview: number
  blockerIssues: number
  affectedUsers: number
  environmentDiff: Array<{ flag: string; dev: number; staging: number; production: number }>
  adoptionTrend: Array<{ date: string; flags: number; rollbacks: number }>
}

export interface FlagFilter {
  keyword?: string
  status?: FlagStatus | ''
  environment?: Environment | ''
  team?: string
  owner?: string
}

export interface ReviewPayload {
  reviewer: string
  decision: 'approved' | 'rejected'
  comment: string
  freezeUntil?: string
}
