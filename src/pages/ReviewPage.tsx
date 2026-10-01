import { useEffect, useState } from 'react'
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
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import { clearReviewSelection, toggleReviewSelection } from '@/app/uiSlice'
import { useGetFlagsQuery, useGetIssuesQuery, useResolveIssueMutation, useReviewFlagMutation } from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'
import type { FeatureFlag, IssueSeverity } from '@/types'

const severityLabel: Record<IssueSeverity, string> = {
  blocker: '阻断',
  warning: '警告',
  info: '提示',
}

export function ReviewPage() {
  const dispatch = useAppDispatch()
  const selectedIds = useAppSelector((state) => state.ui.reviewSelection)
  const { data: flags = [], isLoading } = useGetFlagsQuery({ status: 'review' })
  const { data: issues = [] } = useGetIssuesQuery({ resolved: false })
  const [reviewFlag, reviewState] = useReviewFlagMutation()
  const [resolveIssue, resolveState] = useResolveIssueMutation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved')
  const [comment, setComment] = useState('')
  const [freezeUntil, setFreezeUntil] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (flags.length > 0 && selectedIds.length === 0) dispatch(toggleReviewSelection(flags[0].id))
  }, [dispatch, flags, selectedIds.length])

  const activeFlag = flags.find((flag) => flag.id === selectedIds.at(-1)) ?? flags[0]
  const activeIssues = issues.filter((issue) => issue.flagId === activeFlag?.id)
  const blockerCount = activeIssues.filter((issue) => issue.severity === 'blocker').length
  const invalidatedApproval = activeFlag?.approval?.invalidated ? activeFlag.approval : undefined

  const openDecision = (value: 'approved' | 'rejected') => {
    if (!activeFlag) return
    setDecision(value)
    setComment(value === 'approved' ? '规则、依赖、指标与回滚条件均已核对。' : '存在未解决的影响问题，请修改后重新提交。')
    setDialogOpen(true)
  }

  const handleResolveIssue = async (issueId: string) => {
    try {
      await resolveIssue({ id: issueId, actor: '林默' }).unwrap()
      setMessage('影响问题已标记为解决，可重新批准发布')
    } catch {
      setMessage('处理失败，请重试')
    }
  }

  const submitDecision = async () => {
    if (!activeFlag || comment.trim().length < 8) {
      setMessage('评审意见至少 8 个字符')
      return
    }
    if (decision === 'approved' && blockerCount > 0) {
      setMessage('阻断问题未清零，不能批准发布')
      return
    }
    try {
      await reviewFlag({
        id: activeFlag.id,
        payload: {
          reviewer: '林默',
          decision,
          comment,
          freezeUntil: freezeUntil || undefined,
        },
      }).unwrap()
      setDialogOpen(false)
      dispatch(clearReviewSelection())
      setFreezeUntil('')
      setMessage(decision === 'approved' ? '已批准发布，冻结截止时间与依赖快照已留存' : '已驳回并恢复为草稿')
    } catch {
      setMessage('审批提交失败，请重试')
    }
  }

  const issueCount = (flag: FeatureFlag) =>
    issues.filter((issue) => issue.flagId === flag.id && !issue.resolved).length

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">发布影响评审</Typography>
          <Typography color="text.secondary">
            逐项检查规则冲突、死代码、监控、实验重叠和客户端兼容，条件未满足不能批准。
          </Typography>
        </Box>
        <Chip label={`${flags.length} 项待评审`} color="warning" variant="outlined" />
      </Box>

      {message && (
        <Alert severity={message.includes('失败') || message.includes('不能') ? 'error' : 'success'} onClose={() => setMessage('')} sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}

      <Box className="review-layout">
        <Card>
          <CardHeaderBlock title="评审队列" caption="选择开关查看阻断项并给出条件" />
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>功能开关</TableCell>
                  <TableCell>灰度</TableCell>
                  <TableCell>阻塞问题</TableCell>
                  <TableCell>状态</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {flags.map((flag) => (
                  <TableRow
                    key={flag.id}
                    hover
                    selected={activeFlag?.id === flag.id}
                    onClick={() => {
                      if (!selectedIds.includes(flag.id)) dispatch(toggleReviewSelection(flag.id))
                    }}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox checked={selectedIds.includes(flag.id)} onChange={() => dispatch(toggleReviewSelection(flag.id))} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>{flag.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{flag.owner} · {flag.team}</Typography>
                    </TableCell>
                    <TableCell>{flag.rolloutPercentage}%</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={issueCount(flag) > 0 ? 'error' : 'success'}
                        label={`${issueCount(flag)} 项`}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell><FlagStatusChip status={flag.status} /></TableCell>
                  </TableRow>
                ))}
                {!isLoading && flags.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 5 }} color="text.secondary">
                      当前没有待评审开关
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>

        {activeFlag && (
          <Card className="review-detail">
            <CardContent>
              <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                <Box>
                  <Typography variant="h3">{activeFlag.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{activeFlag.key}</Typography>
                </Box>
                <FlagStatusChip status={activeFlag.status} />
              </Stack>

              <Box className="review-facts">
                <Box><Typography variant="caption">目标环境</Typography><Typography fontWeight={700}>{activeFlag.environment.toUpperCase()}</Typography></Box>
                <Box><Typography variant="caption">灰度比例</Typography><Typography fontWeight={700}>{activeFlag.rolloutPercentage}%</Typography></Box>
                <Box><Typography variant="caption">受众规则</Typography><Typography fontWeight={700}>{activeFlag.audienceRules.length} 条</Typography></Box>
                <Box><Typography variant="caption">监控指标</Typography><Typography fontWeight={700}>{activeFlag.metricNames.length} 个</Typography></Box>
              </Box>

              <Divider sx={{ my: 2 }} />
              {invalidatedApproval && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Typography variant="body2" fontWeight={700}>
                    原审批已失效，需重新复核批准
                  </Typography>
                  <Typography variant="caption">
                    批准人 {invalidatedApproval.reviewer} · 批准于{' '}
                    {invalidatedApproval.approvedAt.slice(0, 16).replace('T', ' ')}
                    {invalidatedApproval.freezeUntil &&
                      ` · 冻结截止 ${invalidatedApproval.freezeUntil.slice(0, 16).replace('T', ' ')}`}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    失效原因：{invalidatedApproval.invalidatedReason}
                  </Typography>
                </Alert>
              )}
              <Typography variant="h3" sx={{ mb: 1 }}>发布条件检查</Typography>
              <Stack spacing={1}>
                {activeIssues.map((issue) => (
                  <Box key={issue.id} className={`issue-item ${issue.severity}`}>
                    <WarningAmberOutlinedIcon fontSize="small" />
                    <Box>
                      <Stack direction="row" spacing={0.7} alignItems="center">
                        <Chip size="small" label={severityLabel[issue.severity]} color={issue.severity === 'blocker' ? 'error' : issue.severity === 'warning' ? 'warning' : 'default'} />
                        <Typography variant="body2" fontWeight={700}>{issue.title}</Typography>
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{issue.detail}</Typography>
                      <Typography variant="caption" color="primary.main">{issue.suggestion}</Typography>
                      <Box sx={{ mt: 0.5 }}>
                        <Button
                          size="small"
                          loading={resolveState.isLoading}
                          onClick={() => void handleResolveIssue(issue.id)}
                        >
                          按建议处理并标记解决
                        </Button>
                      </Box>
                    </Box>
                  </Box>
                ))}
                {activeIssues.length === 0 && (
                  <Alert severity="success">未发现配置影响问题，可进入人工审批。</Alert>
                )}
              </Stack>

              <Divider sx={{ my: 2 }} />
              <Typography variant="h3" sx={{ mb: 1 }}>回滚边界</Typography>
              {activeFlag.rollbackConditions.map((condition) => (
                <Typography key={condition} variant="body2" sx={{ mb: 0.5 }}>• {condition}</Typography>
              ))}

              {activeFlag.approval && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="h3" sx={{ mb: 1 }}>已留存的批准记录与依赖快照</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {activeFlag.approval.reviewer} 于{' '}
                    {activeFlag.approval.approvedAt.slice(0, 16).replace('T', ' ')} 批准
                    {activeFlag.approval.freezeUntil &&
                      ` · 冻结截止 ${activeFlag.approval.freezeUntil.slice(0, 16).replace('T', ' ')}`}
                    {' '}· 共 {activeFlag.approval.dependencySnapshot.length} 项依赖快照
                  </Typography>
                  {activeFlag.approval.dependencySnapshot.map((snapshot) => (
                    <Stack key={snapshot.flagId} direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                      <Chip
                        size="small"
                        color={snapshot.type === 'requires' ? 'info' : snapshot.type === 'conflicts' ? 'warning' : 'default'}
                        label={snapshot.type === 'requires' ? '前置' : snapshot.type === 'conflicts' ? '互斥' : '降级'}
                      />
                      <Typography variant="body2">{snapshot.flagKey}</Typography>
                      <Chip size="small" variant="outlined" label={snapshot.enabled ? '当时启用' : '当时关闭'} />
                    </Stack>
                  ))}
                </>
              )}

              <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleOutlineIcon />}
                  disabled={blockerCount > 0}
                  onClick={() => openDecision('approved')}
                >
                  批准发布
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<CancelOutlinedIcon />}
                  onClick={() => openDecision('rejected')}
                >
                  驳回修改
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{decision === 'approved' ? '批准发布条件' : '驳回发布申请'}</DialogTitle>
        <DialogContent dividers>
          <TextField
            label="评审意见"
            multiline
            minRows={3}
            fullWidth
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          {decision === 'approved' && (
            <>
              <TextField
                select
                label="审批冻结策略"
                fullWidth
                sx={{ mt: 2 }}
                value={freezeUntil}
                onChange={(event) => setFreezeUntil(event.target.value)}
              >
                <MenuItem value="">不冻结扩大流量</MenuItem>
                <MenuItem value="2026-10-01T09:00">冻结至 10 月 1 日 09:00</MenuItem>
                <MenuItem value="2026-10-03T09:00">冻结至 10 月 3 日 09:00</MenuItem>
                <MenuItem value="2026-10-05T18:00">冻结至 10 月 5 日 18:00</MenuItem>
              </TextField>
              <Alert severity="info" sx={{ mt: 2 }}>
                批准后会留存审批人、意见、冻结截止时间与批准当时的依赖快照；冻结期内灰度不能扩量，只能回滚或补监控。
              </Alert>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button
            variant="contained"
            color={decision === 'approved' ? 'success' : 'error'}
            disabled={reviewState.isLoading}
            onClick={() => void submitDecision()}
          >
            {decision === 'approved' ? '确认批准' : '确认驳回'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function CardHeaderBlock({ title, caption }: { title: string; caption: string }) {
  return (
    <Box className="card-header-block">
      <Typography variant="h3">{title}</Typography>
      <Typography variant="caption" color="text.secondary">{caption}</Typography>
    </Box>
  )
}
