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

/** 批准时定格的依赖快照条目，记录当时被依赖/互斥开关的运行态。 */
export interface DependencySnapshotEntry {
  flagId: string
  flagKey: string
  type: Dependency['type']
  enabled: boolean
  status: FlagStatus
  rolloutPercentage: number
  capturedAt: string
}

/** 发布负责人的批准记录，随审批一起留痕。 */
export interface FlagApproval {
  approved: boolean
  reviewer: string
  comment: string
  approvedAt: string
  /** 冻结截止时间（ISO），冻结期内禁止扩大灰度。 */
  freezeUntil: string
  /** 批准时的配置版本，配置改动后与当前版本不一致即失效。 */
  configVersion: number
  /** 批准当时的依赖运行态快照。 */
  dependencySnapshot: DependencySnapshotEntry[]
  /** 批准是否仍然有效；前置暂停、互斥启用、配置改动后置为 false。 */
  valid: boolean
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
  createdAt: string
  updatedAt: string
  lastChangedBy: string
  /** 配置版本号，编辑器保存（实质配置改动）时递增。 */
  configVersion: number
  /** 最近一次发布批准；失效后保留留痕，重新批准会覆盖。 */
  approval?: FlagApproval
}

export interface AuditEvent {
  id: string
  flagId: string
  flagKey: string
  action:
    | 'created'
    | 'updated'
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'frozen'
    | 'unfrozen'
    | 'rolled-back'
    | 'rollout-adjusted'
    | 'metric-supplement'
    | 'approval-invalidated'
    | 'batch-operation'
  actor: string
  summary: string
  before?: string
  after?: string
  affectedUsers: number
  createdAt: string
  /** 幂等键，批量操作重试时用于避免重复审计。 */
  dedupeKey?: string
  /** 关联的批量操作报告。 */
  operationId?: string
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
  /** 冻结截止时间（ISO 字符串），批准时必填。 */
  freezeUntil?: string
}

export type OperationItemKind = 'rollback' | 'freeze' | 'supplement-metric'
export type OperationItemStatus = 'pending' | 'done' | 'failed'

/** 一次批量操作中的单个写入项（一个开关 + 一条审计）。 */
export interface ReleaseOperationItem {
  id: string
  kind: OperationItemKind
  flagId: string
  flagKey: string
  actor: string
  reason: string
  /** supplement-metric 时要补充的监控指标。 */
  metrics?: string[]
  status: OperationItemStatus
  attempts: number
  error?: string
  finishedAt?: string
}

export type ReleaseOperationKind =
  | 'cascade-rollback'
  | 'batch-freeze'
  | 'batch-rollback'
  | 'batch-supplement-metric'

/**
 * 一次可能连带多个开关、审计和报告的发布操作。
 * 写入失败时未完成项保留在队列里，可重试，重开页面后仍能接着处理。
 */
export interface ReleaseOperation {
  id: string
  kind: ReleaseOperationKind
  title: string
  actor: string
  reason: string
  createdAt: string
  createdBy: string
  updatedAt: string
  status: 'running' | 'partial-failed' | 'completed'
  items: ReleaseOperationItem[]
}

export interface ReleaseReport {
  operation: ReleaseOperation
}

export interface ConsoleSettings {
  /** 演练用：模拟主存储写入失败，以验证未完成项的保留与重试。 */
  simulateFailures: boolean
}
