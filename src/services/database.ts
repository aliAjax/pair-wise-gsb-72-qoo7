import type {
  ApprovalRecord,
  AuditEvent,
  DashboardData,
  DependencySnapshotEntry,
  FeatureFlag,
  ImpactIssue,
  OutboxOperation,
  OutboxStep,
  ReleaseReport,
  ReviewPayload,
} from '@/types'

const STORAGE_KEY = 'feature-flag-release-console-v1'
/** 故障注入开关：开启后所有业务写入都会抛错，用于验证 outbox 失败保留与重试 */
const FAULT_KEY = 'feature-flag-release-console-fault-v1'

export interface Database {
  flags: FeatureFlag[]
  audit: AuditEvent[]
  issues: ImpactIssue[]
  outbox: OutboxOperation[]
  reports: ReleaseReport[]
}

const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------
// 故障注入（仅用于演示写入失败后的续跑行为）
// ---------------------------------------------------------------------------

export const isWriteFaultEnabled = (): boolean => localStorage.getItem(FAULT_KEY) === 'on'

export const setWriteFaultEnabled = (enabled: boolean): void => {
  if (enabled) localStorage.setItem(FAULT_KEY, 'on')
  else localStorage.removeItem(FAULT_KEY)
}

/** 不经过故障开关的底层写入，outbox 自身的入队必须始终可落盘 */
const persistDatabase = (database: Database): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database))
}

/** 业务统一写入入口：故障注入开启时抛错，调用方需保留未完成项并重试 */
export const writeDatabase = (database: Database): void => {
  if (isWriteFaultEnabled()) throw new Error('本地存储写入失败（故障注入开启）')
  persistDatabase(database)
}

// ---------------------------------------------------------------------------
// 审批快照与配置指纹
// ---------------------------------------------------------------------------

/** 捕获某个开关在批准时刻的依赖快照（前置 / 互斥 / 降级目标的启用状态） */
export const captureDependencySnapshot = (
  flag: FeatureFlag,
  flagsById: Map<string, FeatureFlag>,
): DependencySnapshotEntry[] => {
  const capturedAt = nowIso()
  return flag.dependencies.map((dependency) => {
    const target = flagsById.get(dependency.flagId)
    return {
      flagId: dependency.flagId,
      flagKey: target?.key ?? dependency.flagId,
      type: dependency.type,
      enabled: target?.enabled ?? false,
      status: target?.status ?? 'draft',
      capturedAt,
    }
  })
}

/**
 * 发布相关配置的指纹：
 * 仅包含审批约束覆盖的发布面（受众、地区、版本、依赖、回滚条件、灰度阶段定义）。
 * 补监控（metricNames）与正常放量推进不参与，避免把冻结期允许的操作误判为配置漂移。
 */
export const buildConfigHash = (flag: FeatureFlag): string =>
  JSON.stringify({
    key: flag.key,
    environment: flag.environment,
    audienceRules: flag.audienceRules,
    regions: flag.regions,
    minClientVersion: flag.minClientVersion,
    dependencies: flag.dependencies,
    rollbackConditions: flag.rollbackConditions,
    deadCodeStatus: flag.deadCodeStatus,
    rolloutSteps: flag.rolloutSteps.map((step) => ({
      percentage: step.percentage,
      audience: step.audience,
      guardrails: step.guardrails,
    })),
  })

/** 冻结截止时间是否仍未过去（无冻结记录视为不在冻结期） */
export const isFreezeActive = (flag: FeatureFlag, at: Date = new Date()): boolean => {
  const freezeUntil = flag.approval?.freezeUntil
  if (!freezeUntil) return false
  return new Date(freezeUntil).getTime() > at.getTime()
}

/** 审批是否仍然有效（未被失效、且冻结截止时间已随批准一并留存） */
export const isApprovalValid = (flag: FeatureFlag): boolean =>
  Boolean(flag.approval && !flag.approval.invalidated)

// ---------------------------------------------------------------------------
// 审批失效
// ---------------------------------------------------------------------------

const pauseRunningSteps = (flag: FeatureFlag): void => {
  flag.rolloutSteps.forEach((step) => {
    if (step.status === 'running') step.status = 'paused'
  })
}

export interface InvalidationResult {
  invalidated: boolean
  reason?: string
}

/** 使某个开关的审批立即失效：运行阶段退回待复核，但保留当前灰度比例 */
export const invalidateApproval = (
  db: Database,
  flag: FeatureFlag,
  reason: string,
  actor = '系统联动',
): InvalidationResult => {
  if (!flag.approval || flag.approval.invalidated) return { invalidated: false }
  const before = `${flag.status} / ${flag.rolloutPercentage}%`
  flag.approval.invalidated = true
  flag.approval.invalidatedAt = nowIso()
  flag.approval.invalidatedReason = reason
  flag.status = 'review'
  pauseRunningSteps(flag)
  flag.updatedAt = nowIso()
  db.audit.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    flagId: flag.id,
    flagKey: flag.key,
    action: 'approval-invalidated',
    actor,
    summary: `审批失效：${reason}，运行阶段已退回待复核，需重新批准后方可扩量。`,
    before,
    after: 'review（待复核）',
    affectedUsers: Math.round(900000 * (flag.rolloutPercentage / 100)),
    createdAt: nowIso(),
  })
  return { invalidated: true, reason }
}

/**
 * 审批一致性扫描：对仍有效的审批检查三类漂移
 *  1. 审批后发布配置被改动（configHash 不一致）
 *  2. 前置依赖被暂停 / 关闭
 *  3. 互斥开关在审批之后才被启用
 */
export const runApprovalSweep = (db: Database): void => {
  const flagsById = new Map(db.flags.map((flag) => [flag.id, flag]))
  for (const flag of db.flags) {
    if (!flag.approval || flag.approval.invalidated) continue
    const reasons: string[] = []

    if (buildConfigHash(flag) !== flag.approval.configHash) {
      reasons.push('批准后发布配置发生改动（受众/依赖/版本/回滚条件/灰度阶段）')
    }

    for (const snapshot of flag.approval.dependencySnapshot) {
      const target = flagsById.get(snapshot.flagId)
      if (snapshot.type === 'requires') {
        if (!target || target.status === 'frozen' || target.status === 'rolled-back' || !target.enabled) {
          reasons.push(
            `前置依赖 ${snapshot.flagKey} 已暂停（${target ? `${target.status}/${target.enabled ? '启用' : '关闭'}` : '不存在'}）`,
          )
        }
      } else if (snapshot.type === 'conflicts') {
        if (target && !snapshot.enabled && target.enabled) {
          reasons.push(`互斥开关 ${snapshot.flagKey} 在批准后才启用`)
        }
      }
    }

    if (reasons.length > 0) {
      invalidateApproval(db, flag, reasons.join('；'))
    }
  }
}

// ---------------------------------------------------------------------------
// 种子数据
// ---------------------------------------------------------------------------

const flags: FeatureFlag[] = [
  {
    id: 'flag-101',
    key: 'checkout.express-pay-v2',
    name: '极速支付流程 V2',
    description: '在结算页启用新的地址确认和支付聚合流程。',
    owner: '陈思远',
    team: '交易体验',
    status: 'review',
    environment: 'staging',
    enabled: false,
    rolloutPercentage: 20,
    audienceRules: [
      { id: 'r-101-1', attribute: 'user.tier', operator: 'in', value: 'gold,platinum', negate: false },
      { id: 'r-101-2', attribute: 'client.platform', operator: 'equals', value: 'ios', negate: false },
      { id: 'r-101-3', attribute: 'account.risk_score', operator: 'lte', value: '40', negate: false },
    ],
    regions: ['CN-EAST', 'CN-SOUTH'],
    minClientVersion: { dev: '8.18.0', staging: '8.18.0', production: '8.18.0' },
    dependencies: [
      { flagId: 'flag-104', type: 'requires', condition: '支付聚合服务已启用' },
      { flagId: 'flag-108', type: 'conflicts', condition: '旧版优惠券浮层不可同时启用' },
    ],
    rollbackConditions: ['支付成功率 5 分钟低于 96%', 'P95 延迟高于 2200ms', '错误率高于 1.2%'],
    metricNames: ['checkout_payment_success_rate', 'checkout_p95_latency'],
    deadCodeStatus: 'candidate',
    rolloutSteps: [
      { id: 's-1', percentage: 1, audience: '内部体验账号', startedAt: '2026-09-25T10:00:00+08:00', status: 'completed', guardrails: ['无阻断错误'] },
      { id: 's-2', percentage: 5, audience: '华东区金卡用户', startedAt: '2026-09-27T14:30:00+08:00', status: 'completed', guardrails: ['支付成功率 > 97%'] },
      { id: 's-3', percentage: 20, audience: 'iOS 金卡及铂金用户', startedAt: '2026-09-29T09:00:00+08:00', status: 'running', guardrails: ['错误率 < 1.2%', 'P95 < 2200ms'] },
      { id: 's-4', percentage: 50, audience: '全量高价值用户', startedAt: '2026-10-02T10:00:00+08:00', status: 'planned', guardrails: ['人工审批'] },
    ],
    createdAt: '2026-09-12T14:20:00+08:00',
    updatedAt: '2026-09-29T09:05:00+08:00',
    lastChangedBy: '陈思远',
  },
  {
    id: 'flag-102',
    key: 'catalog.smart-recommendation',
    name: '商品智能推荐位',
    description: '基于实时意图在商品列表插入推荐模块。',
    owner: '许薇',
    team: '增长算法',
    status: 'active',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 35,
    audienceRules: [
      { id: 'r-102-1', attribute: 'app.version', operator: 'gte', value: '9.2.0', negate: false },
      { id: 'r-102-2', attribute: 'user.segment', operator: 'in', value: 'active,high_intent', negate: false },
    ],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH'],
    minClientVersion: { dev: '9.1.0', staging: '9.2.0', production: '9.2.0' },
    dependencies: [{ flagId: 'flag-105', type: 'requires', condition: '特征服务延迟稳定在 80ms 内' }],
    rollbackConditions: ['推荐模块点击率下降 15%', '接口超时率高于 2%'],
    metricNames: ['recommend_ctr', 'feature_service_timeout_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [
      { id: 's-201', percentage: 10, audience: '活跃用户', startedAt: '2026-09-20T10:00:00+08:00', status: 'completed', guardrails: ['CTR 不低于对照 5%'] },
      { id: 's-202', percentage: 35, audience: '活跃及高意图用户', startedAt: '2026-09-27T10:00:00+08:00', status: 'running', guardrails: ['接口超时率 < 2%'] },
    ],
    createdAt: '2026-08-28T09:30:00+08:00',
    updatedAt: '2026-09-28T16:40:00+08:00',
    lastChangedBy: '周启',
  },
  {
    id: 'flag-103',
    key: 'console.billing-export-v3',
    name: '账单异步导出 V3',
    description: '把大账单导出切换至异步任务和对象存储下载。',
    owner: '周航',
    team: '云控制台',
    status: 'review',
    environment: 'dev',
    enabled: false,
    rolloutPercentage: 0,
    audienceRules: [
      { id: 'r-103-1', attribute: 'account.type', operator: 'equals', value: 'enterprise', negate: false },
    ],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '5.10.0', staging: '5.10.0', production: '5.10.0' },
    dependencies: [{ flagId: 'flag-107', type: 'requires', condition: '异步任务队列容量已扩容' }],
    rollbackConditions: ['任务失败率高于 3%', '导出文件超过 24 小时未生成'],
    metricNames: [],
    deadCodeStatus: 'candidate',
    rolloutSteps: [
      { id: 's-301', percentage: 5, audience: '内部测试企业', startedAt: '2026-10-08T10:00:00+08:00', status: 'planned', guardrails: ['任务成功率 > 98%'] },
    ],
    createdAt: '2026-09-18T11:10:00+08:00',
    updatedAt: '2026-09-28T18:20:00+08:00',
    lastChangedBy: '周航',
  },
  {
    id: 'flag-104',
    key: 'payment.aggregate-router',
    name: '支付聚合路由',
    description: '统一收单渠道和支付降级策略。',
    owner: '韩秋',
    team: '支付平台',
    status: 'active',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH', 'CN-WEST'],
    minClientVersion: { dev: '8.12.0', staging: '8.12.0', production: '8.12.0' },
    dependencies: [],
    rollbackConditions: ['任一收单渠道连续失败 20 次'],
    metricNames: ['payment_router_error_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-401', percentage: 100, audience: '全部用户', startedAt: '2026-07-01T00:00:00+08:00', status: 'completed', guardrails: [] }],
    createdAt: '2026-06-12T10:00:00+08:00',
    updatedAt: '2026-09-25T12:30:00+08:00',
    lastChangedBy: '韩秋',
  },
  {
    id: 'flag-105',
    key: 'feature.realtime-profile',
    name: '实时用户特征服务',
    description: '向推荐和搜索模块提供实时画像特征。',
    owner: '郭宁',
    team: '数据平台',
    status: 'frozen',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 60,
    audienceRules: [],
    regions: ['CN-EAST', 'CN-SOUTH'],
    minClientVersion: { dev: '1.0.0', staging: '1.0.0', production: '1.0.0' },
    dependencies: [],
    rollbackConditions: ['P99 延迟高于 350ms'],
    metricNames: ['feature_service_latency', 'feature_cache_hit_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-501', percentage: 60, audience: '推荐服务流量', startedAt: '2026-09-28T09:00:00+08:00', status: 'paused', guardrails: ['观察缓存命中率'] }],
    createdAt: '2026-05-18T13:40:00+08:00',
    updatedAt: '2026-09-29T08:50:00+08:00',
    lastChangedBy: '郭宁',
  },
  {
    id: 'flag-106',
    key: 'campaign.new-editor',
    name: '活动配置新版编辑器',
    description: '提供拖拽式活动页面配置能力。',
    owner: '梁琪',
    team: '增长运营',
    status: 'rolled-back',
    environment: 'production',
    enabled: false,
    rolloutPercentage: 0,
    audienceRules: [{ id: 'r-106-1', attribute: 'operator.role', operator: 'equals', value: 'campaign_admin', negate: false }],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '2.6.0', staging: '2.6.0', production: '2.6.0' },
    dependencies: [],
    rollbackConditions: ['配置保存失败率高于 2%'],
    metricNames: ['campaign_editor_save_success'],
    deadCodeStatus: 'confirmed',
    rolloutSteps: [{ id: 's-601', percentage: 20, audience: '华东运营团队', startedAt: '2026-09-27T14:00:00+08:00', status: 'paused', guardrails: [] }],
    createdAt: '2026-08-20T10:15:00+08:00',
    updatedAt: '2026-09-28T15:48:00+08:00',
    lastChangedBy: '梁琪',
  },
  {
    id: 'flag-107',
    key: 'infra.async-task-queue-v2',
    name: '异步任务队列 V2',
    description: '迁移长任务至高吞吐队列。',
    owner: '赵岚',
    team: '基础架构',
    status: 'active',
    environment: 'staging',
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '1.0.0', staging: '1.0.0', production: '1.0.0' },
    dependencies: [],
    rollbackConditions: ['队列积压超过 10 万'],
    metricNames: ['queue_backlog', 'task_failure_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-701', percentage: 100, audience: '预发长任务', startedAt: '2026-09-22T09:00:00+08:00', status: 'completed', guardrails: [] }],
    createdAt: '2026-08-10T16:20:00+08:00',
    updatedAt: '2026-09-27T11:12:00+08:00',
    lastChangedBy: '赵岚',
  },
  {
    id: 'flag-108',
    key: 'checkout.legacy-coupon-overlay',
    name: '旧版优惠券浮层',
    description: '结算页旧优惠券选择浮层，计划下版本下线。',
    owner: '沈宁',
    team: '交易体验',
    status: 'frozen',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 12,
    audienceRules: [{ id: 'r-108-1', attribute: 'app.version', operator: 'lte', value: '8.17.9', negate: false }],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH'],
    minClientVersion: { dev: '8.10.0', staging: '8.10.0', production: '8.10.0' },
    dependencies: [{ flagId: 'flag-101', type: 'conflicts', condition: '新版支付流程不可同时启用' }],
    rollbackConditions: ['优惠券使用率下降 10%'],
    metricNames: ['coupon_apply_success_rate'],
    deadCodeStatus: 'confirmed',
    rolloutSteps: [{ id: 's-801', percentage: 12, audience: '低版本客户端', startedAt: '2026-09-20T09:00:00+08:00', status: 'paused', guardrails: [] }],
    createdAt: '2025-12-10T09:00:00+08:00',
    updatedAt: '2026-09-29T09:10:00+08:00',
    lastChangedBy: '沈宁',
  },
]

// flag-102 在 9-26 已获得带冻结截止时间的批准；其前置依赖 flag-105 随后于 9-29 被冻结，
// 首次读取触发一致性扫描时会自动使该审批失效、退回待复核（演示审批失效联动）。
const approval102: ApprovalRecord = {
  id: 'approval-102-1',
  reviewer: '林默',
  approvedAt: '2026-09-26T15:10:00+08:00',
  comment: '指标守护与回滚阈值齐备，批准放量至 35%；冻结期至 9 月 28 日。',
  freezeUntil: '2026-09-28T09:00:00+08:00',
  dependencySnapshot: [
    {
      flagId: 'flag-105',
      flagKey: 'feature.realtime-profile',
      type: 'requires',
      enabled: true,
      status: 'active',
      capturedAt: '2026-09-26T15:10:00+08:00',
    },
  ],
  configHash: '',
}
flags[1].approval = approval102
approval102.configHash = buildConfigHash(flags[1])

const issues: ImpactIssue[] = [
  {
    id: 'issue-1',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    category: 'overlap',
    severity: 'blocker',
    title: '与旧版优惠券实验组重叠',
    detail: '20% 灰度人群中有 3.8% 同时命中 checkout.legacy-coupon-overlay。',
    suggestion: '将 risk_score <= 40 与旧版浮层实验排除条件合并，或先将旧开关灰度降至 0。',
    resolved: false,
  },
  {
    id: 'issue-2',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    category: 'client-compatibility',
    severity: 'warning',
    title: '低版本客户端缺少聚合支付能力',
    detail: 'iOS 8.17.x 用户仍会命中新流程，但客户端未注册 pay.aggregate.v2。',
    suggestion: '把 app.version >= 8.18.0 加入受众前置条件。',
    resolved: false,
  },
  {
    id: 'issue-3',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    category: 'missing-metric',
    severity: 'blocker',
    title: '缺少下载完成率监控',
    detail: '当前仅配置任务创建指标，无法自动触发导出文件生成失败回滚。',
    suggestion: '接入 billing_export_download_success_rate 并配置 15 分钟窗口。',
    resolved: false,
  },
  {
    id: 'issue-4',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    category: 'dead-code',
    severity: 'warning',
    title: '旧同步导出入口仍可达',
    detail: '代码扫描发现 feature.billing_export_sync 分支仍被路由引用。',
    suggestion: '提供旧入口下线任务，并在新开关全量后移除分支。',
    resolved: false,
  },
  {
    id: 'issue-5',
    flagId: 'flag-106',
    flagKey: 'campaign.new-editor',
    category: 'rule-conflict',
    severity: 'warning',
    title: '保存权限中存在互斥角色条件',
    detail: '角色 equals campaign_admin 与后续 not-equals 临时审核员规则同时存在。',
    suggestion: '合并为明确的白名单，避免规则求值顺序变化。',
    resolved: true,
  },
  {
    id: 'issue-6',
    flagId: 'flag-108',
    flagKey: 'checkout.legacy-coupon-overlay',
    category: 'dead-code',
    severity: 'info',
    title: '开关已进入下线候选',
    detail: '最近 30 天没有新增代码引用，仅保留旧客户端兼容分支。',
    suggestion: '在最低客户端版本达到 8.18.0 后安排代码清理。',
    resolved: false,
  },
]

const audit: AuditEvent[] = [
  {
    id: 'audit-1',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    action: 'rollout-adjusted',
    actor: '陈思远',
    summary: '灰度比例由 5% 调整至 20%，仅覆盖 iOS 金卡及铂金用户。',
    before: '5%',
    after: '20%',
    affectedUsers: 48620,
    createdAt: '2026-09-29T09:05:00+08:00',
  },
  {
    id: 'audit-2',
    flagId: 'flag-105',
    flagKey: 'feature.realtime-profile',
    action: 'frozen',
    actor: '郭宁',
    summary: 'P99 延迟升高，冻结配置并暂停扩大流量。',
    before: 'active',
    after: 'frozen',
    affectedUsers: 1200000,
    createdAt: '2026-09-29T08:50:00+08:00',
  },
  {
    id: 'audit-3',
    flagId: 'flag-106',
    flagKey: 'campaign.new-editor',
    action: 'rolled-back',
    actor: '梁琪',
    summary: '配置保存失败率触发自动回滚条件。',
    before: '20%',
    after: '0%',
    affectedUsers: 638,
    createdAt: '2026-09-28T15:48:00+08:00',
  },
  {
    id: 'audit-4',
    flagId: 'flag-102',
    flagKey: 'catalog.smart-recommendation',
    action: 'rollout-adjusted',
    actor: '周启',
    summary: '灰度扩大到 35%，推荐接口错误率保持低于阈值。',
    before: '20%',
    after: '35%',
    affectedUsers: 812430,
    createdAt: '2026-09-28T16:40:00+08:00',
  },
  {
    id: 'audit-5',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    action: 'submitted',
    actor: '周航',
    summary: '提交发布评审，等待补齐导出完成率监控。',
    before: 'draft',
    after: 'draft',
    affectedUsers: 0,
    createdAt: '2026-09-28T18:20:00+08:00',
  },
  {
    id: 'audit-6',
    flagId: 'flag-104',
    flagKey: 'payment.aggregate-router',
    action: 'approved',
    actor: '林默',
    summary: '确认回滚条件和支付通道指标完整。',
    before: 'review',
    after: 'active',
    affectedUsers: 3200000,
    createdAt: '2026-09-25T12:30:00+08:00',
  },
  {
    id: 'audit-7',
    flagId: 'flag-102',
    flagKey: 'catalog.smart-recommendation',
    action: 'approved',
    actor: '林默',
    summary: '批准放量至 35%，冻结截止 2026-09-28 09:00，并留存前置依赖快照。',
    before: 'review',
    after: 'active / freeze-until 2026-09-28T09:00',
    affectedUsers: 812430,
    createdAt: '2026-09-26T15:10:00+08:00',
  },
]

export const seedDatabase = (): Database => ({ flags, audit, issues, outbox: [], reports: [] })

// ---------------------------------------------------------------------------
// 读取：兼容旧版本数据，并在读取时执行审批一致性扫描
// ---------------------------------------------------------------------------

export const readDatabase = (): Database => {
  const raw = localStorage.getItem(STORAGE_KEY)
  let parsed: Database
  if (!raw) {
    parsed = seedDatabase()
  } else {
    try {
      const value = JSON.parse(raw) as Partial<Database>
      parsed = {
        flags: value.flags ?? [],
        audit: value.audit ?? [],
        issues: value.issues ?? [],
        outbox: value.outbox ?? [],
        reports: value.reports ?? [],
      }
    } catch {
      parsed = seedDatabase()
    }
  }
  // 全局联动扫描：发现依赖暂停 / 互斥后启用 / 配置漂移时就地失效审批并落盘
  const before = JSON.stringify(parsed)
  runApprovalSweep(parsed)
  if (JSON.stringify(parsed) !== before || !raw) {
    // 首次初始化或扫描产生失效结果时一并落盘（底层写入，避免故障注入阻断初始化）
    try {
      persistDatabase(parsed)
    } catch {
      // 落盘失败时本次内存状态仍生效，下次读取会重新扫描
    }
  }
  return parsed
}

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

export const applyReview = (flagId: string, payload: ReviewPayload): FeatureFlag => {
  const db = readDatabase()
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const before = flag.status
  const timestamp = nowIso()

  if (payload.decision === 'approved') {
    const flagsById = new Map(db.flags.map((item) => [item.id, item]))
    const approval: ApprovalRecord = {
      id: `approval-${Date.now()}`,
      reviewer: payload.reviewer,
      approvedAt: timestamp,
      comment: payload.comment,
      freezeUntil: payload.freezeUntil,
      dependencySnapshot: captureDependencySnapshot(flag, flagsById),
      configHash: buildConfigHash(flag),
    }
    flag.approval = approval
    flag.status = 'active'
    flag.enabled = true
    flag.updatedAt = timestamp
    flag.lastChangedBy = payload.reviewer
    db.audit.unshift({
      id: `audit-${Date.now()}`,
      flagId,
      flagKey: flag.key,
      action: 'approved',
      actor: payload.reviewer,
      summary: payload.freezeUntil
        ? `${payload.comment}；冻结截止 ${payload.freezeUntil}，冻结期内禁止扩量，仅可回滚或补监控。`
        : payload.comment,
      before,
      after: payload.freezeUntil ? `active / freeze-until ${payload.freezeUntil}` : 'active',
      affectedUsers: Math.round(900000 * (flag.rolloutPercentage / 100)),
      createdAt: timestamp,
    })
  } else {
    flag.status = 'draft'
    flag.enabled = false
    flag.updatedAt = timestamp
    flag.lastChangedBy = payload.reviewer
    db.audit.unshift({
      id: `audit-${Date.now()}`,
      flagId,
      flagKey: flag.key,
      action: 'rejected',
      actor: payload.reviewer,
      summary: payload.comment,
      before,
      after: 'draft',
      affectedUsers: 0,
      createdAt: timestamp,
    })
  }

  writeDatabase(db)
  return flag
}

// ---------------------------------------------------------------------------
// 回滚（单开关；也供 outbox 步骤复用，复用传入的 db）
// ---------------------------------------------------------------------------

export const rollbackFlagInto = (
  db: Database,
  flagId: string,
  actor: string,
  reason: string,
): FeatureFlag => {
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const previousPercentage = flag.rolloutPercentage
  const before = `${flag.status} / ${previousPercentage}%`
  flag.status = 'rolled-back'
  flag.enabled = false
  flag.rolloutPercentage = 0
  flag.updatedAt = nowIso()
  flag.lastChangedBy = actor
  pauseRunningSteps(flag)
  if (flag.approval && !flag.approval.invalidated) {
    flag.approval.invalidated = true
    flag.approval.invalidatedAt = nowIso()
    flag.approval.invalidatedReason = '回滚后审批自动失效'
  }
  db.audit.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    flagId,
    flagKey: flag.key,
    action: 'rolled-back',
    actor,
    summary: reason,
    before,
    after: 'rolled-back / 0%',
    affectedUsers: Math.round(900000 * (previousPercentage / 100)),
    createdAt: nowIso(),
  })
  return flag
}

export const rollbackFlag = (flagId: string, actor: string, reason: string): FeatureFlag => {
  const db = readDatabase()
  const flag = rollbackFlagInto(db, flagId, actor, reason)
  writeDatabase(db)
  return flag
}

// ---------------------------------------------------------------------------
// 冻结期允许的操作：补监控（不改变发布配置指纹，不会使审批失效）
// ---------------------------------------------------------------------------

export const addMetric = (flagId: string, actor: string, metricName: string): FeatureFlag => {
  const db = readDatabase()
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const name = metricName.trim()
  if (!name) throw new Error('指标名不能为空')
  if (flag.metricNames.includes(name)) throw new Error('该监控指标已存在')
  flag.metricNames.push(name)
  flag.updatedAt = nowIso()
  flag.lastChangedBy = actor
  db.audit.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    flagId,
    flagKey: flag.key,
    action: 'metric-added',
    actor,
    summary: `冻结观察期补充监控指标 ${name}，未改变发布配置，审批保持有效。`,
    affectedUsers: Math.round(900000 * (flag.rolloutPercentage / 100)),
    createdAt: nowIso(),
  })
  writeDatabase(db)
  return flag
}

// ---------------------------------------------------------------------------
// outbox：一次操作可连带多个开关、审计和报告；失败保留未完成项，支持重试 / 重开续跑
// ---------------------------------------------------------------------------

const createReportInto = (
  db: Database,
  step: OutboxStep,
  rolledBackFlags: Map<string, FeatureFlag>,
  operation: OutboxOperation,
): ReleaseReport => {
  const items = operation.steps
    .filter((item) => item.type === 'rollback-flag' && item.flagId)
    .map((item) => ({
      flagId: item.flagId as string,
      flagKey: db.flags.find((flag) => flag.id === item.flagId)?.key ?? (item.flagId as string),
      reason: item.reason ?? '',
    }))
  const report: ReleaseReport = {
    id: `report-${Date.now()}`,
    title: step.reportTitle ?? operation.title,
    kind: 'batch-rollback',
    actor: '林默',
    detail: `批量回滚 ${rolledBackFlags.size} 个开关并归档审计与发布报告。`,
    createdAt: nowIso(),
    items,
  }
  db.reports.unshift(report)
  const firstFlagId = items[0]?.flagId ?? ''
  db.audit.unshift({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    flagId: firstFlagId,
    flagKey: items.map((item) => item.flagKey).join(', ') || '批量操作',
    action: 'report-archived',
    actor: '林默',
    summary: `已归档发布报告《${report.title}》，覆盖 ${items.length} 个开关。`,
    affectedUsers: 0,
    createdAt: report.createdAt,
  })
  return report
}

/** 执行 outbox 中所有未完成步骤；失败步骤保留 failed 与尝试次数，供重试或下次重开续跑 */
export const resumeOutbox = (): { processed: number; failed: number } => {
  let db = readDatabase()
  let processed = 0
  let failed = 0
  const rolledBackInRun = new Map<string, FeatureFlag>()

  for (const operation of db.outbox) {
    for (const step of operation.steps) {
      if (step.status === 'done') continue
      step.attempts += 1
      step.lastAttemptedAt = nowIso()
      const failure = (message: string): { processed: number; failed: number } => {
        step.status = 'failed'
        step.error = message
        failed += 1
        // 业务写入失败：丢弃本次内存改动，仅把 outbox 进度（未完成项 + 尝试次数）可靠落盘
        const fresh = readDatabase()
        const targetOp = fresh.outbox.find((item) => item.id === operation.id)
        const targetStep = targetOp?.steps.find((item) => item.id === step.id)
        if (targetStep) {
          targetStep.attempts = step.attempts
          targetStep.lastAttemptedAt = step.lastAttemptedAt
          targetStep.status = 'failed'
          targetStep.error = message
        }
        persistDatabase(fresh)
        return { processed, failed }
      }

      try {
        if (step.type === 'rollback-flag') {
          if (!step.flagId) throw new Error('步骤缺少开关 ID')
          const target = db.flags.find((flag) => flag.id === step.flagId)
          // 幂等：重跑已回滚的步骤时直接标记完成，不重复写审计
          if (target?.status === 'rolled-back') {
            step.status = 'done'
            step.error = undefined
            processed += 1
            continue
          }
          const flag = rollbackFlagInto(
            db,
            step.flagId,
            step.actor ?? '林默',
            step.reason ?? '批量回滚操作',
          )
          rolledBackInRun.set(flag.id, flag)
        } else if (step.type === 'create-report') {
          createReportInto(db, step, rolledBackInRun, operation)
        }
        // 先标记完成再提交：步骤状态与业务数据（开关 / 审计 / 报告）原子落盘
        step.status = 'done'
        step.error = undefined
        writeDatabase(db)
        processed += 1
      } catch (error) {
        // 提交失败后内存库已不可信，后续步骤基于磁盘最新状态继续
        return failure(error instanceof Error ? error.message : '步骤执行失败')
      }
    }
  }

  return { processed, failed }
}

/** 登记一次批量操作（多个开关回滚 + 归档报告），并立即尝试执行 */
export const enqueueBatchRollback = (params: {
  flagIds: string[]
  reason: string
  actor: string
}): OutboxOperation => {
  const db = readDatabase()
  const targets = params.flagIds
    .map((flagId) => db.flags.find((flag) => flag.id === flagId))
    .filter((flag): flag is FeatureFlag => Boolean(flag))
  if (targets.length === 0) throw new Error('请至少选择一个开关')

  const operationId = `op-${Date.now()}`
  const steps: OutboxStep[] = [
    ...targets.map((flag, index) => ({
      id: `${operationId}-step-${index}`,
      type: 'rollback-flag' as const,
      status: 'pending' as const,
      attempts: 0,
      flagId: flag.id,
      actor: params.actor,
      reason: params.reason,
    })),
    {
      id: `${operationId}-step-report`,
      type: 'create-report' as const,
      status: 'pending' as const,
      attempts: 0,
      reportTitle: `批量回滚报告 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    },
  ]
  const operation: OutboxOperation = {
    id: operationId,
    title: `批量回滚 ${targets.length} 个开关`,
    createdAt: nowIso(),
    steps,
  }
  db.outbox.unshift(operation)
  // 入队本身必须可靠落盘，不经过故障开关
  persistDatabase(db)
  return operation
}

export const getDashboardStats = (): DashboardData => {
  const db = readDatabase()
  return {
    activeFlags: db.flags.filter((flag) => flag.enabled).length,
    pendingReview: db.flags.filter((flag) => flag.status === 'review').length + 2,
    blockerIssues: db.issues.filter((issue) => issue.severity === 'blocker' && !issue.resolved).length,
    affectedUsers: 5246900,
    environmentDiff: [
      { flag: '极速支付流程 V2', dev: 100, staging: 20, production: 0 },
      { flag: '账单异步导出 V3', dev: 5, staging: 0, production: 0 },
      { flag: '商品智能推荐位', dev: 100, staging: 50, production: 35 },
      { flag: '实时用户特征服务', dev: 100, staging: 80, production: 60 },
    ],
    adoptionTrend: [
      { date: '09-23', flags: 18, rollbacks: 1 },
      { date: '09-24', flags: 21, rollbacks: 0 },
      { date: '09-25', flags: 19, rollbacks: 2 },
      { date: '09-26', flags: 24, rollbacks: 1 },
      { date: '09-27', flags: 27, rollbacks: 0 },
      { date: '09-28', flags: 31, rollbacks: 3 },
      { date: '09-29', flags: 29, rollbacks: 1 },
    ],
  }
}
