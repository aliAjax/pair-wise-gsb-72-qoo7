import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import PlaylistAddCheckOutlinedIcon from '@mui/icons-material/PlaylistAddCheckOutlined'
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined'
import { Link } from 'react-router-dom'
import {
  useEnqueueBatchRollbackMutation,
  useGetAuditQuery,
  useGetFlagsQuery,
  useGetOutboxQuery,
  useResumeOutboxMutation,
  useRollbackFlagMutation,
} from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'
import { isWriteFaultEnabled, setWriteFaultEnabled } from '@/services/database'
import type { AuditAction, OutboxStep } from '@/types'

const actionLabel: Record<AuditAction, string> = {
  created: '创建',
  updated: '更新',
  submitted: '提交评审',
  approved: '批准',
  rejected: '驳回',
  frozen: '冻结',
  unfrozen: '解冻',
  'rolled-back': '回滚',
  'rollout-adjusted': '调整灰度',
  'approval-invalidated': '审批失效',
  'metric-added': '补监控',
  'report-archived': '归档报告',
}

const stepLabel: Record<OutboxStep['type'], string> = {
  'rollback-flag': '回滚开关',
  'create-report': '归档审计与报告',
}

export function AuditPage() {
  const { data: flags = [] } = useGetFlagsQuery({})
  const { data: outbox = [] } = useGetOutboxQuery()
  const [flagId, setFlagId] = useState('')
  const [action, setAction] = useState('')
  const { data: events = [], isLoading } = useGetAuditQuery({ flagId: flagId || undefined, action: action || undefined })
  const [rollbackFlag, rollbackState] = useRollbackFlagMutation()
  const [enqueueBatch, enqueueState] = useEnqueueBatchRollbackMutation()
  const [resumeOutbox, resumeState] = useResumeOutboxMutation()
  const [selectedFlagId, setSelectedFlagId] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchIds, setBatchIds] = useState<string[]>([])
  const [batchReason, setBatchReason] = useState('')
  const [faultOn, setFaultOn] = useState(isWriteFaultEnabled())

  const selectedFlag = flags.find((flag) => flag.id === selectedFlagId)
  const totalImpact = useMemo(
    () => events.reduce((sum, event) => sum + event.affectedUsers, 0),
    [events],
  )
  const pendingSteps = outbox.reduce(
    (sum, operation) => sum + operation.steps.filter((step) => step.status !== 'done').length,
    0,
  )
  const rollbackableFlags = flags.filter((flag) => flag.status !== 'rolled-back')

  const toggleBatchId = (id: string) => {
    setBatchIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const submitRollback = async () => {
    if (!selectedFlag || reason.trim().length < 8) {
      setMessage('回滚原因至少 8 个字符')
      return
    }
    try {
      await rollbackFlag({ id: selectedFlag.id, actor: '林默', reason }).unwrap()
      setSelectedFlagId('')
      setReason('')
      setMessage('回滚已执行并写入审计记录')
    } catch {
      setMessage('回滚失败，请重试')
    }
  }

  const submitBatch = async () => {
    if (batchIds.length === 0 || batchReason.trim().length < 8) {
      setMessage('请至少选择一个开关，并填写不少于 8 个字符的回滚原因')
      return
    }
    try {
      await enqueueBatch({ flagIds: batchIds, reason: batchReason, actor: '林默' }).unwrap()
      setBatchOpen(false)
      setBatchIds([])
      setBatchReason('')
      setMessage('批量操作已登记：开关回滚、审计与报告逐项写入，可在下方查看进度与重试')
    } catch {
      setMessage('批量操作登记失败，请重试')
    }
  }

  const retryOutbox = async () => {
    try {
      const result = await resumeOutbox().unwrap()
      setMessage(
        result.failed > 0
          ? `续跑完成 ${result.processed} 步，仍有 ${result.failed} 步失败，未完成项已保留`
          : `续跑完成，剩余 ${result.processed} 个未完成项已全部处理`,
      )
    } catch {
      setMessage('续跑失败，未完成项已保留，可再次重试')
    }
  }

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">审计与回滚</Typography>
          <Typography color="text.secondary">
            查看配置调整、审批、冻结、审批失效和异常回滚记录；批量操作逐项写入，失败保留并可续跑。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="error" startIcon={<PlaylistAddCheckOutlinedIcon />} onClick={() => setBatchOpen(true)}>
            批量回滚（多开关 + 审计 + 报告）
          </Button>
          <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={() => window.print()}>
            打印审计记录
          </Button>
        </Stack>
      </Box>

      {message && <Alert severity={message.includes('失败') ? 'error' : 'success'} onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={2}>
            <Box>
              <Typography variant="h3">未完成操作队列（outbox）</Typography>
              <Typography variant="body2" color="text.secondary">
                一次操作连带多个开关、审计和报告；写入失败后保留未完成项，重试或重开页面自动接着处理。
              </Typography>
            </Box>
            <Stack direction="row" spacing={2} alignItems="center">
              <Chip color={pendingSteps > 0 ? 'warning' : 'success'} label={pendingSteps > 0 ? `${pendingSteps} 个未完成项` : '全部完成'} />
              <Button
                variant="outlined"
                size="small"
                startIcon={<ReplayOutlinedIcon />}
                disabled={pendingSteps === 0 || resumeState.isLoading}
                onClick={() => void retryOutbox()}
                loading={resumeState.isLoading}
              >
                重试未完成项
              </Button>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={faultOn}
                    onChange={(event) => {
                      setWriteFaultEnabled(event.target.checked)
                      setFaultOn(event.target.checked)
                      setMessage(event.target.checked ? '故障注入已开启：业务写入将失败，可观察未完成项保留与重试' : '故障注入已关闭，可重试未完成项')
                    }}
                  />
                }
                label="模拟写入失败"
              />
            </Stack>
          </Stack>
          {outbox.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              暂无登记的批量操作。
            </Typography>
          )}
          {outbox.map((operation) => (
            <Box key={operation.id} className="outbox-operation" sx={{ mt: 2 }}>
              <Typography variant="body2" fontWeight={700}>
                {operation.title}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {operation.createdAt.slice(0, 16).replace('T', ' ')}
                </Typography>
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                {operation.steps.map((step) => (
                  <Chip
                    key={step.id}
                    size="small"
                    variant={step.status === 'done' ? 'filled' : 'outlined'}
                    color={step.status === 'done' ? 'success' : step.status === 'failed' ? 'error' : 'warning'}
                    label={`${stepLabel[step.type]}${step.flagId ? ` · ${flags.find((flag) => flag.id === step.flagId)?.key ?? step.flagId}` : ''} · ${
                      step.status === 'done' ? '已完成' : step.status === 'failed' ? `失败（${step.attempts} 次）${step.error ? `：${step.error}` : ''}` : '待处理'
                    }`}
                  />
                ))}
              </Stack>
            </Box>
          ))}
        </CardContent>
      </Card>

      <Box className="audit-summary">
        <Box><Typography variant="caption">审计事件</Typography><Typography className="summary-value">{events.length}</Typography></Box>
        <Box><Typography variant="caption">回滚操作</Typography><Typography className="summary-value">{events.filter((event) => event.action === 'rolled-back').length}</Typography></Box>
        <Box><Typography variant="caption">审批失效</Typography><Typography className="summary-value danger">{events.filter((event) => event.action === 'approval-invalidated').length}</Typography></Box>
        <Box><Typography variant="caption">累计影响用户</Typography><Typography className="summary-value">{totalImpact.toLocaleString()}</Typography></Box>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5}>
            <TextField select label="功能开关" value={flagId} onChange={(event) => setFlagId(event.target.value)} sx={{ width: 280 }}>
              <MenuItem value="">全部开关</MenuItem>
              {flags.map((flag) => <MenuItem key={flag.id} value={flag.id}>{flag.name}</MenuItem>)}
            </TextField>
            <TextField select label="操作类型" value={action} onChange={(event) => setAction(event.target.value)} sx={{ width: 180 }}>
              <MenuItem value="">全部操作</MenuItem>
              {Object.entries(actionLabel).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>时间 / 操作</TableCell>
                <TableCell>功能开关</TableCell>
                <TableCell>变更说明</TableCell>
                <TableCell>状态变化</TableCell>
                <TableCell>影响用户</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.map((event) => {
                const relatedFlag = flags.find((flag) => flag.id === event.flagId)
                return (
                  <TableRow key={event.id} hover selected={event.action === 'approval-invalidated'}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>{actionLabel[event.action] ?? event.action}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {event.createdAt.slice(0, 16).replace('T', ' ')} · {event.actor}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {event.flagId && flags.some((flag) => flag.id === event.flagId) ? (
                        <Typography component={Link} to={`/flags/${event.flagId}`} variant="body2" fontWeight={700}>{event.flagKey}</Typography>
                      ) : (
                        <Typography variant="body2" fontWeight={700}>{event.flagKey}</Typography>
                      )}
                      {relatedFlag && <FlagStatusChip status={relatedFlag.status} />}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 420 }}>{event.summary}</TableCell>
                    <TableCell>
                      {(event.before || event.after) && (
                        <Chip size="small" variant="outlined" label={`${event.before || '-'} → ${event.after || '-'}`} />
                      )}
                    </TableCell>
                    <TableCell>{event.affectedUsers.toLocaleString()}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        startIcon={<UndoOutlinedIcon />}
                        disabled={!relatedFlag || relatedFlag.status === 'rolled-back'}
                        onClick={() => {
                          setSelectedFlagId(event.flagId)
                          setReason('生产异常触发人工回滚，停止继续放量。')
                        }}
                      >
                        回滚
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!isLoading && events.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6 }} color="text.secondary">没有符合条件的审计记录</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={batchOpen} onClose={() => setBatchOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>批量回滚并归档</DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>
            每个开关的回滚、审计事件和发布报告会作为独立步骤顺序写入；中途失败会保留未完成项，可重试或重开后续跑。
          </Alert>
          <Stack sx={{ maxHeight: 240, overflow: 'auto' }}>
            {rollbackableFlags.map((flag) => (
              <FormControlLabel
                key={flag.id}
                control={<Checkbox checked={batchIds.includes(flag.id)} onChange={() => toggleBatchId(flag.id)} />}
                label={`${flag.name} · ${flag.key}（${flag.rolloutPercentage}%）`}
              />
            ))}
            {rollbackableFlags.length === 0 && (
              <Typography variant="body2" color="text.secondary">没有可回滚的开关。</Typography>
            )}
          </Stack>
          <TextField
            label="统一回滚原因与异常证据"
            multiline
            minRows={3}
            fullWidth
            sx={{ mt: 2 }}
            value={batchReason}
            onChange={(event) => setBatchReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBatchOpen(false)}>取消</Button>
          <Button
            variant="contained"
            color="error"
            loading={enqueueState.isLoading}
            disabled={batchIds.length === 0}
            onClick={() => void submitBatch()}
          >
            登记批量操作（{batchIds.length}）
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(selectedFlag)} onClose={() => setSelectedFlagId('')} fullWidth maxWidth="sm">
        <DialogTitle>回滚 {selectedFlag?.name}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>回滚会关闭生产开关、停止灰度并写入审计日志。</Alert>
          <TextField
            label="回滚原因"
            multiline
            minRows={3}
            fullWidth
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedFlagId('')}>取消</Button>
          <Button variant="contained" color="error" loading={rollbackState.isLoading} onClick={() => void submitRollback()}>
            确认回滚
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
