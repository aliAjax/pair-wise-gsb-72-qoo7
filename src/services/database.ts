import type {
  AuditEvent,
  ConsoleSettings,
  DashboardData,
  DependencySnapshotEntry,
  FeatureFlag,
  FlagApproval,
  ImpactIssue,
  ReviewPayload,
} from '@/types'

const STORAGE_KEY = 'feature-flag-release-console-v1'
export const QUEUE_STORAGE_KEY = 'feature-flag-release-console-v1-queue'
const SETTINGS_STORAGE_KEY = 'feature-flag-release-console-v1-settings'

export interface Database {
  flags: FeatureFlag[]
  audit: AuditEvent[]
  issues: ImpactIssue[]
}

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
    configVersion: 3,
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
    configVersion: 5,
    // 批准留痕：冻结窗口已过，但前置依赖 flag-105 已被暂停（frozen），
    // 首次加载时会被复核联动判定为失效，退回待评审。
    approval: {
      approved: true,
      reviewer: '林默',
      comment: '推荐指标与特征服务 SLA 已核对，准予分阶段放量。',
      approvedAt: '2026-09-26T10:00:00+08:00',
      freezeUntil: '2026-09-27T10:00:00+08:00',
      configVersion: 5,
      dependencySnapshot: [
        {
          flagId: 'flag-105',
          flagKey: 'feature.realtime-profile',
          type: 'requires',
          enabled: true,
          status: 'active',
          rolloutPercentage: 60,
          capturedAt: '2026-09-26T10:00:00+08:00',
        },
      ],
      valid: true,
    },
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
    configVersion: 2,
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
    configVersion: 8,
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
    configVersion: 4,
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
    configVersion: 6,
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
    configVersion: 2,
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
    configVersion: 9,
  },
]

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
]

const seedDatabase = (): Database => ({ flags, audit, issues })

/** 兼容旧版本本地数据：补齐新增字段。 */
const migrate = (database: Database): Database => {
  let changed = false
  const nextFlags = database.flags.map((flag) => {
    let next = flag
    if (next.configVersion === undefined) {
      next = { ...next, configVersion: 1 }
      changed = true
    }
    return next
  })
  const next = changed ? { ...database, flags: nextFlags } : database
  return next
}

export const readDatabase = (): Database => {
  if (typeof localStorage === 'undefined') return seedDatabase()
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seed = migrate(seedDatabase())
    persistDatabase(seed)
    return seed
  }
  try {
    return migrate(JSON.parse(raw) as Database)
  } catch {
    const seed = migrate(seedDatabase())
    persistDatabase(seed)
    return seed
  }
}

/** 直接写入主存储；受“模拟写入失败”开关影响。 */
const persistDatabase = (database: Database): void => {
  if (readSettings().simulateFailures) {
    throw new Error('模拟存储写入失败：本地存储不可用')
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database))
}

export const writeDatabase = (database: Database): void => {
  persistDatabase(database)
}

/* ------------------------------------------------------------------ */
/* 冻结窗口                                                            */
/* ------------------------------------------------------------------ */

/** 是否处于冻结期：手动冻结状态，或批准附带的冻结截止时间尚未过去。 */
export const isInFreezeWindow = (flag: FeatureFlag, now = new Date()): boolean => {
  if (flag.status === 'frozen') return true
  if (flag.approval?.valid && new Date(flag.approval.freezeUntil).getTime() > now.getTime()) return true
  return false
}

const estimateAffectedUsers = (percentage: number): number =>
  Math.max(0, Math.round(980000 * (percentage / 100)))

const addAudit = (
  db: Database,
  event: Omit<AuditEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): void => {
  if (event.dedupeKey && db.audit.some((item) => item.dedupeKey === event.dedupeKey)) return
  db.audit.unshift({
    id: event.id ?? `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: event.createdAt ?? new Date().toISOString(),
    ...event,
  })
}

/* ------------------------------------------------------------------ */
/* 批准失效联动（复核）                                                */
/* ------------------------------------------------------------------ */

const describeFlag = (flag: FeatureFlag): string => {
  const statusLabel: Record<string, string> = {
    draft: '草稿',
    review: '待评审',
    active: '已发布',
    frozen: '已暂停/冻结',
    'rolled-back': '已回滚',
  }
  return `${flag.key}（${statusLabel[flag.status] ?? flag.status}${flag.enabled ? `，${flag.rolloutPercentage}%` : '，未启用'}）`
}

export interface InvalidationResult {
  invalidated: Array<{ flag: FeatureFlag; reason: string }>
}

/**
 * 复核所有批准：前置依赖被暂停、互斥开关被启用、配置被改动时，
 * 相关批准立即失效，运行阶段退回待评审。
 * 就地修改传入的 db，可选择为每次失效补写审计事件。
 */
export const reconcileApprovals = (
  db: Database,
  options: { appendAudit?: boolean; actor?: string; at?: string; operationId?: string } = {},
): InvalidationResult => {
  const { appendAudit = true, actor = '系统复核', at = new Date().toISOString(), operationId } = options
  const invalidated: InvalidationResult['invalidated'] = []
  const byId = new Map(db.flags.map((flag) => [flag.id, flag]))

  for (const flag of db.flags) {
    const approval = flag.approval
    if (!approval?.valid) continue

    let reason = ''
    if (approval.configVersion !== flag.configVersion) {
      reason = `配置已被改动（配置版本 ${approval.configVersion} → ${flag.configVersion}），批准基线失效`
    } else {
      for (const dependency of flag.dependencies) {
        const target = byId.get(dependency.flagId)
        if (!target) {
          reason = `前置依赖 ${dependency.flagId} 已不存在，批准基线失效`
          break
        }
        const snapshot = approval.dependencySnapshot.find((entry) => entry.flagId === target.id)
        if (dependency.type === 'requires' && (target.status === 'frozen' || target.status === 'rolled-back' || !target.enabled)) {
          reason = `前置依赖已被暂停或停用：${describeFlag(target)}`
          break
        }
        if (dependency.type === 'conflicts' && target.enabled) {
          reason = `互斥开关在批准后被启用：${describeFlag(target)}`
          break
        }
        if (snapshot) {
          if (dependency.type === 'requires' && snapshot.enabled && !target.enabled) {
            reason = `前置依赖已被停用：${describeFlag(target)}`
            break
          }
          if (dependency.type === 'conflicts' && !snapshot.enabled && target.enabled) {
            reason = `互斥开关在批准后被启用：${describeFlag(target)}`
            break
          }
        }
      }
    }

    if (reason) {
      approval.valid = false
      approval.invalidatedAt = at
      approval.invalidatedReason = reason
      if (flag.status === 'active') flag.status = 'review'
      flag.rolloutSteps = flag.rolloutSteps.map((step) =>
        step.status === 'running' ? { ...step, status: 'paused' as const } : step,
      )
      flag.updatedAt = at
      flag.lastChangedBy = actor
      invalidated.push({ flag, reason })
      if (appendAudit) {
        addAudit(db, {
          id: `audit-invalidate-${flag.id}-${approval.approvedAt}`,
          flagId: flag.id,
          flagKey: flag.key,
          action: 'approval-invalidated',
          actor,
          summary: `发布批准已失效：${reason}，运行阶段退回待复核。`,
          before: 'active（批准有效）',
          after: 'review（待复核）',
          affectedUsers: estimateAffectedUsers(flag.rolloutPercentage),
          createdAt: at,
          dedupeKey: `invalidate:${flag.id}:${approval.approvedAt}`,
          operationId,
        })
      }
    }
  }
  return { invalidated }
}

/** 执行一次开关变更，统一在提交前跑复核联动并写入主存储。 */
const commit = (mutate: (db: Database) => void): Database => {
  const db = readDatabase()
  mutate(db)
  reconcileApprovals(db)
  persistDatabase(db)
  return db
}

/* ------------------------------------------------------------------ */
/* 审批：冻结截止时间 + 依赖快照                                       */
/* ------------------------------------------------------------------ */

const buildDependencySnapshot = (db: Database, flag: FeatureFlag, capturedAt: string): DependencySnapshotEntry[] =>
  flag.dependencies.map((dependency) => {
    const target = db.flags.find((item) => item.id === dependency.flagId)
    return {
      flagId: dependency.flagId,
      flagKey: target?.key ?? dependency.flagId,
      type: dependency.type,
      enabled: target?.enabled ?? false,
      status: target?.status ?? 'draft',
      rolloutPercentage: target?.rolloutPercentage ?? 0,
      capturedAt,
    }
  })

/** 批准前校验前置/互斥依赖的当前运行态。 */
export const validateApprovalDependencies = (
  db: Database,
  flag: FeatureFlag,
): string | null => {
  for (const dependency of flag.dependencies) {
    const target = db.flags.find((item) => item.id === dependency.flagId)
    if (!target) return `依赖开关 ${dependency.flagId} 不存在`
    if (dependency.type === 'requires' && (!target.enabled || target.status === 'frozen' || target.status === 'rolled-back')) {
      return `前置依赖 ${target.name} 当前为${target.enabled ? '暂停' : '停用'}状态，不能批准`
    }
    if (dependency.type === 'conflicts' && target.enabled) {
      return `互斥开关 ${target.name} 当前已启用（${target.rolloutPercentage}%），不能批准`
    }
  }
  return null
}

export const applyReview = (flagId: string, payload: ReviewPayload): FeatureFlag => {
  const db = readDatabase()
  const flag = db.flags.find((item) => item.id === flagId)
  if (!flag) throw new Error('功能开关不存在')
  const before = flag.status
  const timestamp = new Date().toISOString()

  if (payload.decision === 'approved') {
    if (!payload.freezeUntil) throw new Error('批准时必须设置冻结截止时间')
    if (new Date(payload.freezeUntil).getTime() <= Date.now()) {
      throw new Error('冻结截止时间必须晚于当前时间')
    }
    const dependencyError = validateApprovalDependencies(db, flag)
    if (dependencyError) throw new Error(dependencyError)

    const snapshot = buildDependencySnapshot(db, flag, timestamp)
    const approval: FlagApproval = {
      approved: true,
      reviewer: payload.reviewer,
      comment: payload.comment,
      approvedAt: timestamp,
      freezeUntil: new Date(payload.freezeUntil).toISOString(),
      configVersion: flag.configVersion,
      dependencySnapshot: snapshot,
      valid: true,
    }
    flag.status = 'active'
    flag.enabled = true
    flag.approval = approval
    addAudit(db, {
      flagId,
      flagKey: flag.key,
      action: 'approved',
      actor: payload.reviewer,
      summary: `${payload.comment}｜冻结截止 ${approval.freezeUntil}，已留存 ${snapshot.length} 项依赖快照。`,
      before,
      after: `active / 冻结至 ${approval.freezeUntil}`,
      affectedUsers: estimateAffectedUsers(flag.rolloutPercentage),
      createdAt: timestamp,
    })
  } else {
    flag.status = 'draft'
    flag.enabled = false
    if (flag.approval) {
      flag.approval = {
        ...flag.approval,
        valid: false,
        invalidatedAt: timestamp,
        invalidatedReason: '评审被驳回',
      }
    }
    addAudit(db, {
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

  flag.updatedAt = timestamp
  flag.lastChangedBy = payload.reviewer
  reconcileApprovals(db)
  persistDatabase(db)
  return flag
}

/* ------------------------------------------------------------------ */
/* 灰度运行：推进（受冻结约束）、冻结、补监控、回滚                    */
/* ------------------------------------------------------------------ */

export class FreezeWindowError extends Error {}

export const advanceRollout = (flagId: string, actor: string): FeatureFlag => {
  let updated: FeatureFlag | undefined
  commit((db) => {
    const flag = db.flags.find((item) => item.id === flagId)
    if (!flag) throw new Error('功能开关不存在')
    if (isInFreezeWindow(flag)) {
      throw new FreezeWindowError(
        '冻结窗口尚未过去，灰度阶段不能扩量；只能紧急回滚或补充监控。',
      )
    }
    const currentIndex = flag.rolloutSteps.findIndex((step) => step.status === 'running')
    if (currentIndex < 0 || currentIndex >= flag.rolloutSteps.length - 1) {
      throw new Error('没有可推进的灰度阶段')
    }
    const beforePercentage = flag.rolloutPercentage
    flag.rolloutSteps = flag.rolloutSteps.map((step, index) => ({
      ...step,
      status:
        index === currentIndex
          ? ('completed' as const)
          : index === currentIndex + 1
            ? ('running' as const)
            : step.status,
    }))
    const nextPercentage =
      flag.rolloutSteps.find((step) => step.status === 'running')?.percentage ?? beforePercentage
    flag.rolloutPercentage = nextPercentage
    flag.enabled = true
    flag.status = 'active'
    flag.updatedAt = new Date().toISOString()
    flag.lastChangedBy = actor
    addAudit(db, {
      flagId,
      flagKey: flag.key,
      action: 'rollout-adjusted',
      actor,
      summary: `冻结窗口已过，灰度由 ${beforePercentage}% 推进至 ${nextPercentage}%。`,
      before: `${beforePercentage}%`,
      after: `${nextPercentage}%`,
      affectedUsers: estimateAffectedUsers(nextPercentage),
    })
    updated = flag
  })
  return updated as FeatureFlag
}

export const freezeFlag = (
  flagId: string,
  actor: string,
  reason: string,
  context: { operationId?: string; dedupeKey?: string } = {},
): FeatureFlag => {
  let updated: FeatureFlag | undefined
  commit((db) => {
    const flag = db.flags.find((item) => item.id === flagId)
    if (!flag) throw new Error('功能开关不存在')
    if (flag.status === 'frozen') {
      updated = flag
      return
    }
    const before = `${flag.status} / ${flag.rolloutPercentage}%`
    flag.status = 'frozen'
    flag.rolloutSteps = flag.rolloutSteps.map((step) =>
      step.status === 'running' ? { ...step, status: 'paused' as const } : step,
    )
    flag.updatedAt = new Date().toISOString()
    flag.lastChangedBy = actor
    addAudit(db, {
      flagId,
      flagKey: flag.key,
      action: 'frozen',
      actor,
      summary: reason,
      before,
      after: 'frozen',
      affectedUsers: estimateAffectedUsers(flag.rolloutPercentage),
      operationId: context.operationId,
      dedupeKey: context.dedupeKey,
    })
    updated = flag
  })
  return updated as FeatureFlag
}

export const supplementMetrics = (
  flagId: string,
  actor: string,
  metrics: string[],
  reason: string,
  context: { operationId?: string; dedupeKey?: string } = {},
): FeatureFlag => {
  let updated: FeatureFlag | undefined
  commit((db) => {
    const flag = db.flags.find((item) => item.id === flagId)
    if (!flag) throw new Error('功能开关不存在')
    const additions = metrics.map((metric) => metric.trim()).filter(
      (metric) => metric.length > 0 && !flag.metricNames.includes(metric),
    )
    if (additions.length === 0) {
      updated = flag
      return
    }
    // 补监控不改配置版本、不使批准失效；冻结窗口下唯一允许的“增强”动作。
    flag.metricNames = [...flag.metricNames, ...additions]
    flag.updatedAt = new Date().toISOString()
    flag.lastChangedBy = actor
    addAudit(db, {
      flagId,
      flagKey: flag.key,
      action: 'metric-supplement',
      actor,
      summary: `${reason}，补充监控指标 ${additions.join('、')}。`,
      before: `${flag.metricNames.length - additions.length} 个指标`,
      after: `${flag.metricNames.length} 个指标`,
      affectedUsers: estimateAffectedUsers(flag.rolloutPercentage),
      operationId: context.operationId,
      dedupeKey: context.dedupeKey,
    })
    updated = flag
  })
  return updated as FeatureFlag
}

export const rollbackFlag = (
  flagId: string,
  actor: string,
  reason: string,
  context: { operationId?: string; dedupeKey?: string } = {},
): FeatureFlag => {
  let updated: FeatureFlag | undefined
  commit((db) => {
    const flag = db.flags.find((item) => item.id === flagId)
    if (!flag) throw new Error('功能开关不存在')
    if (flag.status === 'rolled-back') {
      updated = flag
      return
    }
    const previousPercentage = flag.rolloutPercentage
    const before = `${flag.status} / ${previousPercentage}%`
    flag.status = 'rolled-back'
    flag.enabled = false
    flag.rolloutPercentage = 0
    flag.updatedAt = new Date().toISOString()
    flag.lastChangedBy = actor
    if (flag.approval?.valid) {
      flag.approval.valid = false
      flag.approval.invalidatedAt = new Date().toISOString()
      flag.approval.invalidatedReason = '执行紧急回滚'
    }
    flag.rolloutSteps = flag.rolloutSteps.map((step) =>
      step.status === 'running' ? { ...step, status: 'paused' as const } : step,
    )
    addAudit(db, {
      flagId,
      flagKey: flag.key,
      action: 'rolled-back',
      actor,
      summary: reason,
      before,
      after: 'rolled-back / 0%',
      affectedUsers: estimateAffectedUsers(previousPercentage),
      operationId: context.operationId,
      dedupeKey: context.dedupeKey,
    })
    updated = flag
  })
  return updated as FeatureFlag
}

/* ------------------------------------------------------------------ */
/* 设置：模拟写入失败演练开关（独立存储，不随主库失败）                */
/* ------------------------------------------------------------------ */

export const readSettings = (): ConsoleSettings => {
  if (typeof localStorage === 'undefined') return { simulateFailures: false }
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ConsoleSettings) : { simulateFailures: false }
  } catch {
    return { simulateFailures: false }
  }
}

export const writeSettings = (settings: ConsoleSettings): void => {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

/* ------------------------------------------------------------------ */
/* 启动联动复核                                                        */
/* ------------------------------------------------------------------ */

/**
 * 应用启动时执行一次复核并落库：让“前置被暂停 / 互斥后启用 / 配置改动”
 * 立即让相关批准失效、退回待评审，并留下审计事件。
 * 演练写入失败时静默跳过，界面仍会在读取时做内存态复核。
 */
export const reconcileOnStartup = (): InvalidationResult => {
  try {
    const db = readDatabase()
    const result = reconcileApprovals(db, { appendAudit: true, actor: '系统复核' })
    if (result.invalidated.length > 0) persistDatabase(db)
    return result
  } catch {
    return { invalidated: [] }
  }
}

/* ------------------------------------------------------------------ */
/* 概览数据                                                            */
/* ------------------------------------------------------------------ */

export const getDashboardStats = (): DashboardData => {
  const db = readDatabase()
  // 内存态复核：让概览立即反映“前置暂停 → 批准失效 → 待复核”，不落库。
  reconcileApprovals(db, { appendAudit: false })
  return {
    activeFlags: db.flags.filter((flag) => flag.enabled && flag.status === 'active').length,
    pendingReview: db.flags.filter((flag) => flag.status === 'review').length,
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
