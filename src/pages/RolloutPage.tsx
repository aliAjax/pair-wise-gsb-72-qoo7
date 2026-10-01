import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline'
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined'
import {
  useAdvanceRolloutMutation,
  useCascadeRollbackMutation,
  useGetFlagsQuery,
  useRollbackFlagMutation,
  useSaveFlagMutation,
  useSupplementMetricsMutation,
} from '@/services/flagApi'
import { isInFreezeWindow } from '@/services/database'
import { FlagStatusChip } from '@/components/FlagStatusChip'
import type { DependencySnapshotEntry } from '@/types'

const formatDateTime = (value: string): string =>
  new Date(value).toLocaleString('zh-CN', { hour12: false })

const dependencyTypeLabel = {
  requires: '前置依赖',
  conflicts: '互斥开关',
  fallback: '降级路径',
} as const

export function RolloutPage() {
  const { data: flags = [], isLoading } = useGetFlagsQuery({})
  const [selectedId, setSelectedId] = useState('')
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [metricOpen, setMetricOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [metricNames, setMetricNames] = useState('')
  const [message, setMessage] = useState('')
  const [saveFlag, saveState] = useSaveFlagMutation()
  const [rollbackFlag, rollbackState] = useRollbackFlagMutation()
  const [advanceRollout, advanceState] = useAdvanceRolloutMutation()
  const [supplementMetrics, metricState] = useSupplementMetricsMutation()
  const [cascadeRollback, cascadeState] = useCascadeRollbackMutation()

  useEffect(() => {
    if (!selectedId && flags.length > 0) setSelectedId(flags[0].id)
  }, [flags, selectedId])

  const flag = flags.find((item) => item.id === selectedId)
  const currentStepIndex = flag?.rolloutSteps.findIndex((step) => step.status === 'running') ?? -1
  const frozen = flag ? isInFreezeWindow(flag) : false
  const approvalInvalid = flag?.approval && !flag.approval.valid

  const advance = async () => {
    if (!flag) return
    try {
      await advanceRollout(flag.id).unwrap()
      setMessage('灰度已推进到下一阶段，变更已写入审计日志')
    } catch (error) {
      const apiError = error as { data?: { message?: string } }
      setMessage(apiError?.data?.message ?? '推进失败，请检查配置后重试')
    }
  }

  const pauseRollout = async () => {
    if (!flag) return
    try {
      await saveFlag({
        ...flag,
        status: 'frozen',
        lastChangedBy: '林默',
        rolloutSteps: flag.rolloutSteps.map((step) =>
          step.status === 'running' ? { ...step, status: 'paused' } : step,
        ),
      }).unwrap()
      setMessage('灰度流量已冻结，现有用户继续使用当前配置')
    } catch {
      setMessage('冻结失败，请重试')
    }
  }

  const submitMetrics = async () => {
    if (!flag) return
    const metrics = metricNames.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
    if (metrics.length === 0) {
      setMessage('请填写至少一个要补充的监控指标')
      return
    }
    try {
      await supplementMetrics({ id: flag.id, metrics, reason: reason || '冻结窗口内补充守护监控' }).unwrap()
      setMetricOpen(false)
      setMetricNames('')
      setReason('')
      setMessage('监控指标已补充，批准继续有效，操作已写入审计日志')
    } catch (error) {
      const apiError = error as { data?: { message?: string } }
      setMessage(apiError?.data?.message ?? '补监控失败，请重试')
    }
  }

  const submitRollback = async (cascade: boolean) => {
    if (!flag || reason.trim().length < 8) {
      setMessage('回滚原因至少 8 个字符')
      return
    }
    try {
      if (cascade) {
        const operation = await cascadeRollback({ id: flag.id, actor: '林默', reason }).unwrap()
        const failed = operation.items.filter((item) => item.status !== 'done').length
        setRollbackOpen(false)
        setReason('')
        setMessage(
          failed > 0
            ? `连带回滚已处理 ${operation.items.length - failed}/${operation.items.length} 个开关，未完成项已保留，可在顶部重试`
            : `连带回滚完成，共处理 ${operation.items.length} 个关联开关并生成操作报告`,
        )
      } else {
        await rollbackFlag({ id: flag.id, actor: '林默', reason }).unwrap()
        setRollbackOpen(false)
        setReason('')
        setMessage('已完成回滚，开关关闭并写入审计日志')
      }
    } catch {
      setMessage('回滚失败，请重试')
    }
  }

  const snapshotRows = flag?.approval?.dependencySnapshot ?? []

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">灰度发布时间线</Typography>
          <Typography color="text.secondary">
            冻结窗口内只能回滚或补监控；冻结过去后方可扩量。每次变化记录影响范围与操作者。
          </Typography>
        </Box>
        <TextField
          select
          label="发布目标"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          sx={{ width: 300 }}
        >
          {flags.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
        </TextField>
      </Box>

      {message && <Alert severity={message.includes('失败') || message.includes('不能') ? 'error' : 'success'} onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}
      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      {flag && approvalInvalid && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={700}>该开关的发布批准已失效，运行阶段已退回待复核</Typography>
          <Typography variant="body2">原因：{flag.approval?.invalidatedReason}</Typography>
          <Typography variant="caption">失效时间：{flag.approval?.invalidatedAt ? formatDateTime(flag.approval.invalidatedAt) : '-'}</Typography>
        </Alert>
      )}

      {flag && (
        <>
          {frozen && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {flag.status === 'frozen'
                ? '开关处于手动冻结状态：灰度不能扩量，只能紧急回滚或补充监控。'
                : `批准冻结窗口持续到 ${formatDateTime(flag.approval!.freezeUntil)}：冻结没过去前不能扩量，只能紧急回滚或补监控。`}
            </Alert>
          )}

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h3">{flag.name}</Typography>
                    <FlagStatusChip status={flag.status} />
                    {frozen && <Chip size="small" color="warning" label="冻结中" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{flag.key} · 当前 {flag.rolloutPercentage}%</Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" startIcon={<PauseCircleOutlineIcon />} onClick={() => void pauseRollout()} disabled={saveState.isLoading || flag.status === 'frozen'}>
                    冻结流量
                  </Button>
                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={<MonitorHeartOutlinedIcon />}
                    onClick={() => {
                      setMetricNames('')
                      setReason('冻结窗口内补充守护监控')
                      setMetricOpen(true)
                    }}
                  >
                    补监控
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<PlayArrowOutlinedIcon />}
                    onClick={() => void advance()}
                    loading={advanceState.isLoading}
                    disabled={frozen || currentStepIndex < 0 || currentStepIndex >= flag.rolloutSteps.length - 1}
                  >
                    推进下一阶段
                  </Button>
                  <Button color="error" variant="outlined" startIcon={<UndoOutlinedIcon />} onClick={() => setRollbackOpen(true)}>
                    紧急回滚
                  </Button>
                </Stack>
              </Stack>
              <Stepper activeStep={Math.max(currentStepIndex, 0)} alternativeLabel>
                {flag.rolloutSteps.map((step) => (
                  <Step key={step.id} completed={step.status === 'completed'}>
                    <StepLabel
                      optional={
                        <Typography variant="caption" color={step.status === 'paused' ? 'warning.main' : 'text.secondary'}>
                          {step.audience}
                        </Typography>
                      }
                    >
                      {step.percentage}% · {step.status === 'completed' ? '已完成' : step.status === 'running' ? '进行中' : step.status === 'paused' ? '已暂停' : '计划中'}
                    </StepLabel>
                  </Step>
                ))}
              </Stepper>
            </CardContent>
          </Card>

          {flag.approval && (
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
                  <Box>
                    <Typography variant="h3">发布批准留痕</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {flag.approval.reviewer} 批准于 {formatDateTime(flag.approval.approvedAt)}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    color={flag.approval.valid ? 'success' : 'error'}
                    label={flag.approval.valid ? '批准有效' : '批准已失效'}
                  />
                </Stack>
                <Box className="review-facts">
                  <Box>
                    <Typography variant="caption">冻结截止时间</Typography>
                    <Typography fontWeight={700}>{formatDateTime(flag.approval.freezeUntil)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption">批准配置版本</Typography>
                    <Typography fontWeight={700}>v{flag.approval.configVersion}{flag.approval.configVersion !== flag.configVersion ? `（当前 v${flag.configVersion}）` : ''}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption">依赖快照</Typography>
                    <Typography fontWeight={700}>{snapshotRows.length} 项</Typography>
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{flag.approval.comment}</Typography>
                {snapshotRows.length > 0 && (
                  <Stack spacing={1} sx={{ mt: 2 }}>
                    {snapshotRows.map((entry: DependencySnapshotEntry) => {
                      const live = flags.find((item) => item.id === entry.flagId)
                      const drifted =
                        live && (
                          live.enabled !== entry.enabled ||
                          live.status !== entry.status ||
                          live.rolloutPercentage !== entry.rolloutPercentage
                        )
                      return (
                        <Box key={`${entry.flagId}-${entry.capturedAt}`} className="guardrail-row">
                          <Box>
                            <Stack direction="row" spacing={0.7} alignItems="center">
                              <Chip size="small" label={dependencyTypeLabel[entry.type]} color={entry.type === 'conflicts' ? 'error' : 'primary'} variant="outlined" />
                              <Typography variant="body2" fontWeight={700}>{entry.flagKey}</Typography>
                              {drifted && <Chip size="small" color="warning" label="运行态已漂移" />}
                            </Stack>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                              快照：{entry.enabled ? '启用' : '停用'} · {entry.status} · {entry.rolloutPercentage}%
                              {live ? ` ｜ 当前：${live.enabled ? '启用' : '停用'} · ${live.status} · ${live.rolloutPercentage}%` : ' ｜ 当前：开关已不存在'}
                            </Typography>
                          </Box>
                        </Box>
                      )
                    })}
                  </Stack>
                )}
              </CardContent>
            </Card>
          )}

          <Box className="rollout-grid">
            <Card>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1.5 }}>阶段守护指标</Typography>
                {flag.rolloutSteps.map((step) => (
                  <Box key={step.id} className="guardrail-row">
                    <Box>
                      <Typography variant="body2" fontWeight={700}>{step.percentage}% · {step.audience}</Typography>
                      <Stack direction="row" spacing={0.7} sx={{ mt: 0.7 }} flexWrap="wrap" useFlexGap>
                        {step.guardrails.map((guardrail) => <Chip key={guardrail} size="small" variant="outlined" label={guardrail} />)}
                      </Stack>
                    </Box>
                    <Chip
                      size="small"
                      label={step.status === 'completed' ? '已通过' : step.status === 'running' ? '观察中' : step.status === 'paused' ? '已暂停' : '待执行'}
                      color={step.status === 'completed' ? 'success' : step.status === 'running' ? 'primary' : step.status === 'paused' ? 'warning' : 'default'}
                    />
                  </Box>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1.5 }}>环境差异与客户端约束</Typography>
                <Box className="environment-compare">
                  {(['dev', 'staging', 'production'] as const).map((environment, index) => (
                    <Box key={environment}>
                      <Typography variant="caption" color="text.secondary">{environment.toUpperCase()}</Typography>
                      <Typography className="summary-value">{index === 0 ? 100 : index === 1 ? flag.rolloutPercentage : Math.max(flag.rolloutPercentage - 20, 0)}%</Typography>
                      <Typography variant="caption">最低 {flag.minClientVersion[environment]}</Typography>
                    </Box>
                  ))}
                </Box>
                <Alert severity="warning" sx={{ mt: 2 }}>
                  生产环境低于最低版本的用户会走降级路径，不会命中新逻辑。
                </Alert>
                <Typography variant="h3" sx={{ mt: 2.5, mb: 1 }}>回滚条件</Typography>
                {flag.rollbackConditions.map((condition) => <Typography key={condition} variant="body2">• {condition}</Typography>)}
              </CardContent>
            </Card>
          </Box>
        </>
      )}

      <Dialog open={metricOpen} onClose={() => setMetricOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>补充守护监控 · {flag?.name}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="info" sx={{ mb: 2 }}>
            冻结窗口下允许的增强动作：只新增监控指标，不改变配置基线、不使批准失效。
          </Alert>
          <TextField
            label="监控指标（逗号或换行分隔）"
            multiline
            minRows={2}
            fullWidth
            value={metricNames}
            onChange={(event) => setMetricNames(event.target.value)}
            placeholder="checkout_error_rate, checkout_p99_latency"
          />
          <TextField
            label="补充原因"
            multiline
            minRows={2}
            fullWidth
            sx={{ mt: 2 }}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMetricOpen(false)}>取消</Button>
          <Button variant="contained" color="warning" loading={metricState.isLoading} onClick={() => void submitMetrics()}>
            确认补监控
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rollbackOpen} onClose={() => setRollbackOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认紧急回滚 · {flag?.name}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>
            回滚会立即关闭开关、将灰度降至 0，并把所有运行中阶段标记为暂停。冻结窗口下回滚始终允许。
          </Alert>
          <Alert severity="info" sx={{ mb: 2 }}>
            选择“连带回滚”会把依赖该开关的下游开关一并回滚，生成批量操作报告；写入失败的项会保留并可重试。
          </Alert>
          <TextField
            label="回滚原因与异常证据"
            multiline
            minRows={3}
            fullWidth
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackOpen(false)}>取消</Button>
          <Button color="error" onClick={() => void submitRollback(false)} loading={rollbackState.isLoading}>
            仅回滚本开关
          </Button>
          <Button color="error" variant="contained" onClick={() => void submitRollback(true)} loading={cascadeState.isLoading}>
            连带回滚下游
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
