import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  advanceRollout,
  applyReview,
  FreezeWindowError,
  getDashboardStats,
  readDatabase,
  reconcileApprovals,
  rollbackFlag,
  supplementMetrics,
  writeDatabase,
  writeSettings,
  readSettings,
} from '@/services/database'
import {
  collectCascadeRollbackTargets,
  createOperation,
  getOperations,
  getRecoverableOperations,
  processOperation,
  resumePendingOperations,
} from '@/services/operations'
import type {
  ConsoleSettings,
  DashboardData,
  FeatureFlag,
  FlagFilter,
  ImpactIssue,
  ReleaseOperation,
  ReviewPayload,
} from '@/types'

const delay = (milliseconds = 180) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const CONFIG_CHANGED_FIELDS: Array<keyof FeatureFlag> = [
  'audienceRules',
  'regions',
  'minClientVersion',
  'dependencies',
  'rollbackConditions',
  'environment',
  'key',
]

const isConfigChanged = (before: FeatureFlag, after: FeatureFlag): boolean =>
  CONFIG_CHANGED_FIELDS.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))

export const flagApi = createApi({
  reducerPath: 'flagApi',
  baseQuery: fakeBaseQuery<{ message: string }>(),
  tagTypes: ['Flags', 'Flag', 'Issues', 'Audit', 'Dashboard', 'Operations', 'Settings'],
  endpoints: (builder) => ({
    getDashboard: builder.query<DashboardData, void>({
      async queryFn() {
        await delay()
        return { data: getDashboardStats() }
      },
      providesTags: ['Dashboard'],
    }),
    getFlags: builder.query<FeatureFlag[], FlagFilter>({
      async queryFn(filters) {
        await delay()
        const keyword = filters.keyword?.trim().toLowerCase()
        const db = readDatabase()
        // 内存态复核，使列表即时反映批准失效与待复核状态（不落审计）。
        reconcileApprovals(db, { appendAudit: false })
        const data = db.flags.filter(
          (flag) =>
            (!filters.status || flag.status === filters.status) &&
            (!filters.environment || flag.environment === filters.environment) &&
            (!filters.team || flag.team === filters.team) &&
            (!filters.owner || flag.owner === filters.owner) &&
            (!keyword ||
              flag.name.toLowerCase().includes(keyword) ||
              flag.key.toLowerCase().includes(keyword) ||
              flag.owner.toLowerCase().includes(keyword)),
        )
        return { data }
      },
      providesTags: ['Flags'],
    }),
    getFlag: builder.query<FeatureFlag, string>({
      async queryFn(id) {
        await delay()
        const db = readDatabase()
        reconcileApprovals(db, { appendAudit: false })
        const flag = db.flags.find((item) => item.id === id)
        return flag ? { data: flag } : { error: { message: '功能开关不存在' } }
      },
      providesTags: (_result, _error, id) => [{ type: 'Flag', id }],
    }),
    saveFlag: builder.mutation<FeatureFlag, FeatureFlag>({
      async queryFn(flag) {
        await delay(260)
        const db = readDatabase()
        const index = db.flags.findIndex((item) => item.id === flag.id)
        try {
          if (index >= 0) {
            const before = db.flags[index]
            const configChanged = isConfigChanged(before, flag)
            const next: FeatureFlag = {
              ...flag,
              configVersion: configChanged ? before.configVersion + 1 : before.configVersion,
              updatedAt: new Date().toISOString(),
            }
            db.flags[index] = next
            db.audit.unshift({
              id: `audit-${Date.now()}`,
              flagId: flag.id,
              flagKey: flag.key,
              action: 'updated',
              actor: flag.lastChangedBy,
              summary: configChanged
                ? '更新开关受众、依赖、版本或回滚条件，配置基线发生变化。'
                : '更新开关说明信息，未改变发布配置基线。',
              before: before.status,
              after: next.status,
              affectedUsers: Math.round(980000 * (next.rolloutPercentage / 100)),
              createdAt: new Date().toISOString(),
            })
          } else {
            const next: FeatureFlag = { ...flag, configVersion: flag.configVersion ?? 1, updatedAt: new Date().toISOString() }
            db.flags.unshift(next)
            db.audit.unshift({
              id: `audit-${Date.now()}`,
              flagId: next.id,
              flagKey: next.key,
              action: 'created',
              actor: next.lastChangedBy,
              summary: '创建功能开关草稿。',
              after: next.status,
              affectedUsers: 0,
              createdAt: new Date().toISOString(),
            })
          }
          // 配置改动会在这里把受影响开关的批准联动失效。
          reconcileApprovals(db)
          writeDatabase(db)
          return { data: db.flags[index] ?? db.flags[0] }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '保存失败' } }
        }
      },
      invalidatesTags: ['Flags', 'Dashboard', 'Audit'],
    }),
    submitForReview: builder.mutation<FeatureFlag, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(220)
        const db = readDatabase()
        const flag = db.flags.find((item) => item.id === id)
        if (!flag) return { error: { message: '功能开关不存在' } }
        try {
          flag.status = 'review'
          flag.updatedAt = new Date().toISOString()
          flag.lastChangedBy = actor
          db.audit.unshift({
            id: `audit-${Date.now()}`,
            flagId: id,
            flagKey: flag.key,
            action: 'submitted',
            actor,
            summary: '提交发布影响评审。',
            before: 'draft',
            after: 'review',
            affectedUsers: Math.round(980000 * (flag.rolloutPercentage / 100)),
            createdAt: new Date().toISOString(),
          })
          reconcileApprovals(db)
          writeDatabase(db)
          return { data: flag }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '提交失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    reviewFlag: builder.mutation<FeatureFlag, { id: string; payload: ReviewPayload }>({
      async queryFn({ id, payload }) {
        await delay(260)
        try {
          return { data: applyReview(id, payload) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '审批失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    advanceRollout: builder.mutation<FeatureFlag, string>({
      async queryFn(id) {
        await delay(260)
        try {
          return { data: advanceRollout(id, '林默') }
        } catch (error) {
          if (error instanceof FreezeWindowError) {
            return { error: { message: error.message } }
          }
          return { error: { message: error instanceof Error ? error.message : '推进失败' } }
        }
      },
      invalidatesTags: (_result, _error, id) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id },
      ],
    }),
    supplementMetrics: builder.mutation<FeatureFlag, { id: string; metrics: string[]; reason: string }>({
      async queryFn({ id, metrics, reason }) {
        await delay(220)
        try {
          return { data: supplementMetrics(id, '林默', metrics, reason) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '补监控失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Audit',
        'Dashboard',
        { type: 'Flag', id: arg.id },
      ],
    }),
    rollbackFlag: builder.mutation<FeatureFlag, { id: string; actor: string; reason: string }>({
      async queryFn({ id, actor, reason }) {
        await delay(260)
        try {
          return { data: rollbackFlag(id, actor, reason) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '回滚失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    cascadeRollback: builder.mutation<ReleaseOperation, { id: string; actor: string; reason: string }>({
      async queryFn({ id, actor, reason }) {
        const targetIds = collectCascadeRollbackTargets(id)
        try {
          const operation = await createOperation({
            kind: 'cascade-rollback',
            actor,
            reason,
            items: targetIds.map((targetId) => ({
              kind: 'rollback',
              flagId: targetId,
              reason: `连带回滚：${reason}`,
            })),
          })
          return { data: operation }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '操作未创建' } }
        }
      },
      invalidatesTags: ['Flags', 'Dashboard', 'Audit', 'Operations'],
    }),
    batchOperation: builder.mutation<
      ReleaseOperation,
      {
        kind: 'batch-freeze' | 'batch-rollback' | 'batch-supplement-metric'
        ids: string[]
        actor: string
        reason: string
        metrics?: string[]
      }
    >({
      async queryFn({ kind, ids, actor, reason, metrics }) {
        try {
          const operation = await createOperation({
            kind,
            actor,
            reason,
            items: ids.map((flagId) => ({
              kind: kind === 'batch-freeze' ? 'freeze' : kind === 'batch-rollback' ? 'rollback' : 'supplement-metric',
              flagId,
              metrics,
              reason,
            })),
          })
          return { data: operation }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '操作未创建' } }
        }
      },
      invalidatesTags: ['Flags', 'Dashboard', 'Audit', 'Operations'],
    }),
    getOperations: builder.query<ReleaseOperation[], void>({
      async queryFn() {
        await delay(120)
        return { data: getOperations() }
      },
      providesTags: ['Operations'],
    }),
    getRecoverableOperations: builder.query<ReleaseOperation[], void>({
      async queryFn() {
        return { data: getRecoverableOperations() }
      },
      providesTags: ['Operations'],
    }),
    resumeOperation: builder.mutation<ReleaseOperation | undefined, string>({
      async queryFn(id) {
        try {
          const operation = await processOperation(id)
          return { data: operation }
        } catch (error) {
          const operation = getOperations().find((item) => item.id === id)
          if (operation) return { data: operation }
          return { error: { message: error instanceof Error ? error.message : '重试失败' } }
        }
      },
      invalidatesTags: ['Flags', 'Dashboard', 'Audit', 'Operations'],
    }),
    resumeAllOperations: builder.mutation<ReleaseOperation[], void>({
      async queryFn() {
        try {
          const operations = await resumePendingOperations()
          return { data: operations }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '恢复失败' } }
        }
      },
      invalidatesTags: ['Flags', 'Dashboard', 'Audit', 'Operations'],
    }),
    getSettings: builder.query<ConsoleSettings, void>({
      async queryFn() {
        return { data: readSettings() }
      },
      providesTags: ['Settings'],
    }),
    setFailureSimulation: builder.mutation<ConsoleSettings, boolean>({
      async queryFn(enabled) {
        const settings = { simulateFailures: enabled }
        writeSettings(settings)
        return { data: settings }
      },
      invalidatesTags: ['Settings'],
    }),
    getIssues: builder.query<ImpactIssue[], { category?: string; resolved?: boolean }>({
      async queryFn(filters) {
        await delay()
        const data = readDatabase().issues.filter(
          (issue) =>
            (!filters.category || issue.category === filters.category) &&
            (filters.resolved === undefined || issue.resolved === filters.resolved),
        )
        return { data }
      },
      providesTags: ['Issues'],
    }),
    getAudit: builder.query<import('@/types').AuditEvent[], { flagId?: string; action?: string }>({
      async queryFn(filters) {
        await delay()
        const data = readDatabase().audit.filter(
          (event) =>
            (!filters.flagId || event.flagId === filters.flagId) &&
            (!filters.action || event.action === filters.action),
        )
        return { data }
      },
      providesTags: ['Audit'],
    }),
  }),
})

export const {
  useGetDashboardQuery,
  useGetFlagsQuery,
  useGetFlagQuery,
  useSaveFlagMutation,
  useSubmitForReviewMutation,
  useReviewFlagMutation,
  useAdvanceRolloutMutation,
  useSupplementMetricsMutation,
  useRollbackFlagMutation,
  useCascadeRollbackMutation,
  useBatchOperationMutation,
  useGetOperationsQuery,
  useGetRecoverableOperationsQuery,
  useResumeOperationMutation,
  useResumeAllOperationsMutation,
  useGetSettingsQuery,
  useSetFailureSimulationMutation,
  useGetIssuesQuery,
  useGetAuditQuery,
} = flagApi
