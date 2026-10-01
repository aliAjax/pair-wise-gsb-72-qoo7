import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  addMetric,
  applyReview,
  buildConfigHash,
  enqueueBatchRollback,
  getDashboardStats,
  invalidateApproval,
  readDatabase,
  resumeOutbox,
  rollbackFlag,
  writeDatabase,
} from '@/services/database'
import type {
  AuditEvent,
  DashboardData,
  FeatureFlag,
  FlagFilter,
  ImpactIssue,
  OutboxOperation,
  ReleaseReport,
  ReviewPayload,
} from '@/types'

const delay = (milliseconds = 180) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const uniqueId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export const flagApi = createApi({
  reducerPath: 'flagApi',
  baseQuery: fakeBaseQuery<{ message: string }>(),
  tagTypes: ['Flags', 'Flag', 'Issues', 'Audit', 'Dashboard', 'Outbox', 'Reports'],
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
        const data = readDatabase().flags.filter(
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
        const flag = readDatabase().flags.find((item) => item.id === id)
        return flag ? { data: flag } : { error: { message: '功能开关不存在' } }
      },
      providesTags: (_result, _error, id) => [{ type: 'Flag', id }],
    }),
    saveFlag: builder.mutation<FeatureFlag, FeatureFlag>({
      async queryFn(flag) {
        await delay(260)
        const db = readDatabase()
        const index = db.flags.findIndex((item) => item.id === flag.id)
        const next = { ...flag, updatedAt: new Date().toISOString() }
        if (index >= 0) {
          const before = db.flags[index]
          // 审批后若发布面配置（受众/依赖/版本/回滚条件/阶段定义）发生改动，审批立即失效
          let drifted = false
          if (before.approval && !before.approval.invalidated) {
            drifted = buildConfigHash(next) !== before.approval.configHash
          }
          db.flags[index] = next
          db.audit.unshift({
            id: uniqueId('audit'),
            flagId: flag.id,
            flagKey: flag.key,
            action: 'updated',
            actor: flag.lastChangedBy,
            summary: '更新开关受众、依赖、版本或回滚条件。',
            before: before.status,
            after: next.status,
            affectedUsers: Math.round(900000 * (next.rolloutPercentage / 100)),
            createdAt: new Date().toISOString(),
          })
          if (drifted) {
            invalidateApproval(
              db,
              next,
              '发布负责人批准后配置被改动（受众 / 依赖 / 版本 / 回滚条件 / 灰度阶段）',
              flag.lastChangedBy,
            )
          }
        } else {
          db.flags.unshift(next)
          db.audit.unshift({
            id: uniqueId('audit'),
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
        writeDatabase(db)
        return { data: next }
      },
      invalidatesTags: ['Flags', 'Dashboard', 'Audit'],
    }),
    submitForReview: builder.mutation<FeatureFlag, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(220)
        const db = readDatabase()
        const flag = db.flags.find((item) => item.id === id)
        if (!flag) return { error: { message: '功能开关不存在' } }
        flag.status = 'review'
        flag.updatedAt = new Date().toISOString()
        flag.lastChangedBy = actor
        db.audit.unshift({
          id: uniqueId('audit'),
          flagId: id,
          flagKey: flag.key,
          action: 'submitted',
          actor,
          summary: '提交发布影响评审。',
          before: 'draft',
          after: 'review',
          affectedUsers: Math.round(900000 * (flag.rolloutPercentage / 100)),
          createdAt: new Date().toISOString(),
        })
        writeDatabase(db)
        return { data: flag }
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
        'Outbox',
        'Reports',
        { type: 'Flag', id: arg.id },
      ],
    }),
    /** 冻结观察期补充监控：不改变发布配置指纹，审批保持有效 */
    addMetric: builder.mutation<FeatureFlag, { id: string; actor: string; metricName: string }>({
      async queryFn({ id, actor, metricName }) {
        await delay(220)
        try {
          return { data: addMetric(id, actor, metricName) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '补充监控失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    resolveIssue: builder.mutation<ImpactIssue, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(180)
        const db = readDatabase()
        const issue = db.issues.find((item) => item.id === id)
        if (!issue) return { error: { message: '影响问题不存在' } }
        issue.resolved = true
        db.audit.unshift({
          id: uniqueId('audit'),
          flagId: issue.flagId,
          flagKey: issue.flagKey,
          action: 'updated',
          actor,
          summary: `影响问题已处理：${issue.title}`,
          before: '未解决',
          after: '已解决',
          affectedUsers: 0,
          createdAt: new Date().toISOString(),
        })
        writeDatabase(db)
        return { data: issue }
      },
      invalidatesTags: ['Issues', 'Audit', 'Dashboard'],
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
    getAudit: builder.query<AuditEvent[], { flagId?: string; action?: string }>({
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
    getOutbox: builder.query<OutboxOperation[], void>({
      async queryFn() {
        await delay()
        return { data: readDatabase().outbox }
      },
      providesTags: ['Outbox'],
    }),
    getReports: builder.query<ReleaseReport[], void>({
      async queryFn() {
        await delay()
        return { data: readDatabase().reports }
      },
      providesTags: ['Reports'],
    }),
    /** 登记一次连带多开关 + 审计 + 报告的批量操作，立即尝试续跑 */
    enqueueBatchRollback: builder.mutation<
      OutboxOperation,
      { flagIds: string[]; reason: string; actor: string }
    >({
      async queryFn(payload) {
        await delay(120)
        try {
          const operation = enqueueBatchRollback(payload)
          resumeOutbox()
          return { data: operation }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '批量操作登记失败' } }
        }
      },
      invalidatesTags: ['Outbox', 'Flags', 'Audit', 'Reports', 'Dashboard'],
    }),
    /** 重试所有未完成步骤（页面重开时也会自动触发） */
    resumeOutbox: builder.mutation<{ processed: number; failed: number }, void>({
      async queryFn() {
        await delay(160)
        try {
          return { data: resumeOutbox() }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '续跑失败' } }
        }
      },
      invalidatesTags: ['Outbox', 'Flags', 'Audit', 'Reports', 'Dashboard'],
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
  useRollbackFlagMutation,
  useAddMetricMutation,
  useResolveIssueMutation,
  useGetIssuesQuery,
  useGetAuditQuery,
  useGetOutboxQuery,
  useGetReportsQuery,
  useEnqueueBatchRollbackMutation,
  useResumeOutboxMutation,
} = flagApi
