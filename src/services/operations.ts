import {
  QUEUE_STORAGE_KEY,
  freezeFlag,
  readDatabase,
  rollbackFlag,
  supplementMetrics,
} from '@/services/database'
import type {
  AuditEvent,
  ReleaseOperation,
  ReleaseOperationItem,
  ReleaseOperationKind,
} from '@/types'

/**
 * 批量发布操作的持久化队列。
 *
 * 队列保存在与主数据库不同的 localStorage 键中：即使主库写入失败
 * （演练开关或真实的存储异常），未完成项依然保留。重开页面后可以
 * 接着处理，已经完成的项依靠幂等键不会重复写开关和审计。
 */

const ITEM_DELAY = 260

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const readQueue = (): ReleaseOperation[] => {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ReleaseOperation[]) : []
  } catch {
    return []
  }
}

const writeQueue = (operations: ReleaseOperation[]): void => {
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(operations))
}

const saveOperation = (operation: ReleaseOperation): void => {
  const queue = readQueue()
  const index = queue.findIndex((item) => item.id === operation.id)
  if (index >= 0) queue[index] = operation
  else queue.unshift(operation)
  writeQueue(queue)
}

export const getOperations = (): ReleaseOperation[] => readQueue()

export const getOperation = (id: string): ReleaseOperation | undefined =>
  readQueue().find((operation) => operation.id === id)

const summarize = (operation: ReleaseOperation): ReleaseOperation['status'] => {
  if (operation.items.some((item) => item.status === 'failed')) return 'partial-failed'
  if (operation.items.every((item) => item.status === 'done')) return 'completed'
  return 'running'
}

const runItem = async (operation: ReleaseOperation, item: ReleaseOperationItem): Promise<void> => {
  const dedupeKey = `${operation.id}:${item.id}`
  await wait(ITEM_DELAY)
  if (item.kind === 'rollback') {
    rollbackFlag(item.flagId, item.actor, item.reason, {
      operationId: operation.id,
      dedupeKey,
    })
  } else if (item.kind === 'freeze') {
    freezeFlag(item.flagId, item.actor, item.reason, {
      operationId: operation.id,
      dedupeKey,
    })
  } else {
    supplementMetrics(item.flagId, item.actor, item.metrics ?? [], item.reason, {
      operationId: operation.id,
      dedupeKey,
    })
  }
}

/**
 * 处理操作中所有未完成项。逐项提交：
 * - 某项写入失败时，该项标记 failed，保留在队列里并中断本次处理；
 * - 调用方（或重开后的恢复流程）可以再次调用本函数从断点继续；
 * - 每个项都会先落一次“处理中”检查点，因此刷新/关闭页面也不丢项。
 */
export const processOperation = async (
  operationId: string,
): Promise<ReleaseOperation | undefined> => {
  const queue = readQueue()
  const operation = queue.find((item) => item.id === operationId)
  if (!operation) return undefined

  for (const item of operation.items) {
    if (item.status === 'done') continue

    item.attempts += 1
    item.status = 'pending'
    operation.updatedAt = new Date().toISOString()
    operation.status = summarize(operation)
    saveOperation(operation)

    try {
      await runItem(operation, item)
      item.status = 'done'
      item.error = undefined
      item.finishedAt = new Date().toISOString()
    } catch (error) {
      item.status = 'failed'
      item.error = error instanceof Error ? error.message : '写入失败'
      operation.updatedAt = new Date().toISOString()
      operation.status = 'partial-failed'
      saveOperation(operation)
      throw error
    }

    operation.updatedAt = new Date().toISOString()
    operation.status = summarize(operation)
    saveOperation(operation)
  }

  return getOperation(operationId)
}

const operationTitle: Record<ReleaseOperationKind, string> = {
  'cascade-rollback': '连带回滚',
  'batch-freeze': '批量冻结',
  'batch-rollback': '批量回滚',
  'batch-supplement-metric': '批量补监控',
}

export interface CreateOperationInput {
  kind: ReleaseOperationKind
  actor: string
  reason: string
  items: Array<Pick<ReleaseOperationItem, 'kind' | 'flagId' | 'metrics' | 'reason'>>
}

/** 创建操作并立刻持久化检查点（先于任何写入），随后开始逐项处理。 */
export const createOperation = async (input: CreateOperationInput): Promise<ReleaseOperation> => {
  const db = readDatabase()
  const timestamp = new Date().toISOString()
  const id = `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const items: ReleaseOperationItem[] = input.items.map((item, index) => {
    const flag = db.flags.find((flagItem) => flagItem.id === item.flagId)
    return {
      id: `${id}-item-${index + 1}`,
      kind: item.kind,
      flagId: item.flagId,
      flagKey: flag?.key ?? item.flagId,
      actor: input.actor,
      reason: item.reason || input.reason,
      metrics: item.metrics,
      status: 'pending',
      attempts: 0,
    }
  })

  const operation: ReleaseOperation = {
    id,
    kind: input.kind,
    title: operationTitle[input.kind],
    actor: input.actor,
    reason: input.reason,
    createdAt: timestamp,
    createdBy: input.actor,
    updatedAt: timestamp,
    status: 'running',
    items,
  }

  // 操作报告检查点先落盘，保证后续写入失败时未完成项仍然可恢复。
  saveOperation(operation)

  try {
    await processOperation(id)
  } catch {
    // 失败已体现在操作报告里，交由界面重试/恢复。
  }
  return getOperation(id) ?? operation
}

/** 收集一次连带回滚涉及的全部开关：目标 + 它启用的下游依赖者。 */
export const collectCascadeRollbackTargets = (flagId: string): string[] => {
  const db = readDatabase()
  const targets = new Set<string>([flagId])
  for (const flag of db.flags) {
    if (!flag.enabled) continue
    const requiresTarget = flag.dependencies.some(
      (dependency) =>
        (dependency.type === 'requires' || dependency.type === 'fallback') &&
        targets.has(dependency.flagId),
    )
    if (requiresTarget) targets.add(flag.id)
  }
  return [...targets]
}

/** 查询待恢复的操作（仍有 pending 或 failed 项）。 */
export const getRecoverableOperations = (): ReleaseOperation[] =>
  readQueue().filter((operation) =>
    operation.items.some((item) => item.status !== 'done'),
  )

/** 启动时恢复：自动继续所有还在 pending 的操作；failed 项保留给人工重试。 */
export const resumePendingOperations = async (): Promise<ReleaseOperation[]> => {
  const pending = readQueue().filter((operation) =>
    operation.items.some((item) => item.status === 'pending'),
  )
  for (const operation of pending) {
    try {
      await processOperation(operation.id)
    } catch {
      // 恢复时遇到写入失败，等待人工关闭演练开关后重试。
    }
  }
  return getRecoverableOperations()
}

/** 汇总操作产出的审计事件，用于操作报告。 */
export const getOperationAudit = (operationId: string): AuditEvent[] =>
  readDatabase().audit.filter((event) => event.operationId === operationId)
