import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
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
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined'
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined'
import { useGetAuditQuery, useGetDashboardQuery, useGetFlagsQuery, useGetIssuesQuery, useGetOperationsQuery, useResumeAllOperationsMutation, useResumeOperationMutation } from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'

const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`

const operationStatusLabel: Record<string, { label: string; color: 'success' | 'warning' | 'error' | 'default' }> = {
  completed: { label: '已完成', color: 'success' },
  running: { label: '处理中', color: 'warning' },
  'partial-failed': { label: '部分失败待重试', color: 'error' },
}

const itemStatusLabel: Record<string, string> = {
  done: '已完成',
  pending: '待处理',
  failed: '失败',
}

const itemKindLabel: Record<string, string> = {
  rollback: '回滚',
  freeze: '冻结',
  'supplement-metric': '补监控',
}

export function ReportsPage() {
  const [environment, setEnvironment] = useState('')
  const [message, setMessage] = useState('')
  const { data: flags = [], isLoading } = useGetFlagsQuery({})
  const { data: dashboard } = useGetDashboardQuery()
  const { data: issues = [] } = useGetIssuesQuery({})
  const { data: audit = [] } = useGetAuditQuery({})
  const { data: operations = [] } = useGetOperationsQuery(undefined, { pollingInterval: 2000 })
  const [resumeOperation, resumeState] = useResumeOperationMutation()
  const [resumeAll, resumeAllState] = useResumeAllOperationsMutation()

  const unfinishedCount = operations.reduce(
    (sum, operation) => sum + operation.items.filter((item) => item.status !== 'done').length,
    0,
  )

  const reportFlags = useMemo(
    () => flags.filter((flag) => !environment || flag.environment === environment),
    [environment, flags],
  )

  const exportReport = () => {
    const rows = [
      ['开关Key', '名称', '环境', '状态', '灰度比例', '负责人', '团队', '受众规则', '依赖数', '监控指标', '回滚条件', '预计影响用户'],
      ...reportFlags.map((flag) => [
        flag.key,
        flag.name,
        flag.environment,
        flag.status,
        `${flag.rolloutPercentage}%`,
        flag.owner,
        flag.team,
        flag.audienceRules.length,
        flag.dependencies.length,
        flag.metricNames.join('|'),
        flag.rollbackConditions.join('|'),
        Math.round(980000 * (flag.rolloutPercentage / 100)),
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `feature-flag-release-report-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    setMessage('发布报告已导出')
  }

  const riskFlags = reportFlags.filter((flag) => {
    const flagIssues = issues.filter((issue) => issue.flagId === flag.id && !issue.resolved)
    return flagIssues.some((issue) => issue.severity === 'blocker')
  })

  const exportOperations = () => {
    const rows = [
      ['操作ID', '操作类型', '原因', '操作人', '创建时间', '状态', '子项开关', '子项动作', '子项状态', '尝试次数', '错误信息'],
      ...operations.flatMap((operation) =>
        operation.items.map((item) => [
          operation.id,
          operation.title,
          operation.reason,
          operation.actor,
          operation.createdAt,
          operation.status,
          item.flagKey,
          itemKindLabel[item.kind] ?? item.kind,
          itemStatusLabel[item.status] ?? item.status,
          item.attempts,
          item.error ?? '',
        ]),
      ),
    ]
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `release-operations-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    setMessage('批量操作报告已导出')
  }

  const retryOperation = async (id: string) => {
    try {
      await resumeOperation(id).unwrap()
      setMessage('未完成项已继续处理')
    } catch (error) {
      const apiError = error as { data?: { message?: string } }
      setMessage(apiError?.data?.message ?? '重试失败，请确认写入失败演练已关闭')
    }
  }

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">发布报告</Typography>
          <Typography color="text.secondary">
            汇总开关配置、影响评审问题、灰度状态与审计轨迹，导出可归档的发布报告。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField select label="环境范围" value={environment} onChange={(event) => setEnvironment(event.target.value)} sx={{ width: 160 }}>
            <MenuItem value="">全部环境</MenuItem>
            <MenuItem value="dev">开发</MenuItem>
            <MenuItem value="staging">预发</MenuItem>
            <MenuItem value="production">生产</MenuItem>
          </TextField>
          <Button variant="contained" startIcon={<DownloadOutlinedIcon />} onClick={exportReport}>
            导出 CSV
          </Button>
        </Stack>
      </Box>

      {message && <Alert severity="success" onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}
      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Box className="report-summary">
        <Box className="report-summary-main">
          <AssessmentOutlinedIcon />
          <Box>
            <Typography variant="caption">报告范围</Typography>
            <Typography className="summary-value">{reportFlags.length} 个开关</Typography>
          </Box>
        </Box>
        <Box><Typography variant="caption">生产已启用</Typography><Typography className="summary-value">{reportFlags.filter((flag) => flag.enabled).length}</Typography></Box>
        <Box><Typography variant="caption">未解决阻断项</Typography><Typography className="summary-value danger">{riskFlags.length}</Typography></Box>
        <Box><Typography variant="caption">审计事件</Typography><Typography className="summary-value">{audit.length}</Typography></Box>
        <Box><Typography variant="caption">影响用户</Typography><Typography className="summary-value">{(dashboard?.affectedUsers ?? 0).toLocaleString()}</Typography></Box>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
            <Box>
              <Typography variant="h3">批量操作报告</Typography>
              <Typography variant="caption" color="text.secondary">
                一次操作连带多个开关、审计和报告；写入失败保留未完成项，可重试，重开页面仍能接着处理。
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                startIcon={<ReplayOutlinedIcon />}
                color="warning"
                disabled={unfinishedCount === 0 || resumeState.isLoading || resumeAllState.isLoading}
                onClick={() => void resumeAll()}
              >
                重试全部未完成项（{unfinishedCount}）
              </Button>
              <Button size="small" variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={exportOperations} disabled={operations.length === 0}>
                导出操作 CSV
              </Button>
            </Stack>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>操作 / 原因</TableCell>
                  <TableCell>子项（开关 · 动作 · 状态）</TableCell>
                  <TableCell>进度</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {operations.map((operation) => {
                  const done = operation.items.filter((item) => item.status === 'done').length
                  const failed = operation.items.filter((item) => item.status === 'failed').length
                  const status = operationStatusLabel[operation.status] ?? operationStatusLabel.running
                  return (
                    <TableRow key={operation.id} hover>
                      <TableCell sx={{ maxWidth: 260 }}>
                        <Typography variant="body2" fontWeight={700}>{operation.title}</Typography>
                        <Typography variant="caption" color="text.secondary">{operation.actor} · {operation.createdAt.slice(0, 16).replace('T', ' ')}</Typography>
                        <Typography variant="caption" display="block" color="text.secondary">{operation.reason}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 380 }}>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {operation.items.map((item) => (
                            <Chip
                              key={item.id}
                              size="small"
                              variant="outlined"
                              color={item.status === 'done' ? 'success' : item.status === 'failed' ? 'error' : 'default'}
                              label={`${item.flagKey} · ${itemKindLabel[item.kind]} · ${itemStatusLabel[item.status]}`}
                            />
                          ))}
                        </Stack>
                        {failed > 0 && (
                          <Typography variant="caption" color="error.main" display="block" sx={{ mt: 0.5 }}>
                            {operation.items.find((item) => item.status === 'failed')?.error}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{done}/{operation.items.length}</TableCell>
                      <TableCell><Chip size="small" color={status.color === 'warning' ? 'warning' : status.color} label={status.label} /></TableCell>
                      <TableCell align="right">
                        {operation.status !== 'completed' && (
                          <Button size="small" startIcon={<ReplayOutlinedIcon />} onClick={() => void retryOperation(operation.id)} loading={resumeState.isLoading}>
                            继续处理
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {operations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }} color="text.secondary">
                      还没有批量操作，可在“功能开关”页多选后发起批量冻结、回滚或补监控
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Box className="report-grid">
        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 2 }}>环境采用率</Typography>
            {dashboard?.environmentDiff.map((item) => (
              <Box key={item.flag} className="report-bar-row">
                <Box className="report-bar-copy">
                  <Typography variant="body2" fontWeight={700}>{item.flag}</Typography>
                  <Typography variant="caption" color="text.secondary">DEV {item.dev}% · STG {item.staging}% · PROD {item.production}%</Typography>
                </Box>
                <Box className="report-bar-track"><Box className="report-bar-fill" sx={{ width: `${Math.max(item.production, item.staging / 2)}%` }} /></Box>
              </Box>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 2 }}>影响问题分布</Typography>
            <Box className="issue-distribution">
              {(['blocker', 'warning', 'info'] as const).map((severity) => {
                const count = issues.filter((issue) => issue.severity === severity && !issue.resolved).length
                return (
                  <Box key={severity}>
                    <Chip color={severity === 'blocker' ? 'error' : severity === 'warning' ? 'warning' : 'default'} size="small" label={severity === 'blocker' ? '阻断' : severity === 'warning' ? '警告' : '提示'} />
                    <Typography className="summary-value">{count}</Typography>
                    <Typography variant="caption" color="text.secondary">未解决</Typography>
                  </Box>
                )
              })}
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1.5 }}>发布明细</Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>功能开关</TableCell>
                  <TableCell>环境 / 状态</TableCell>
                  <TableCell>灰度</TableCell>
                  <TableCell>影响规则</TableCell>
                  <TableCell>监控与回滚</TableCell>
                  <TableCell>最后变更</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportFlags.map((flag) => (
                  <TableRow key={flag.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>{flag.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{flag.key}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={flag.environment.toUpperCase()} />
                      <Box sx={{ mt: 0.5 }}><FlagStatusChip status={flag.status} /></Box>
                    </TableCell>
                    <TableCell>{flag.rolloutPercentage}%</TableCell>
                    <TableCell>{flag.audienceRules.length} 条规则 · {flag.regions.length} 地区</TableCell>
                    <TableCell>{flag.metricNames.length} 指标 · {flag.rollbackConditions.length} 回滚条件</TableCell>
                    <TableCell>
                      <Typography variant="body2">{flag.lastChangedBy}</Typography>
                      <Typography variant="caption" color="text.secondary">{flag.updatedAt.slice(0, 16).replace('T', ' ')}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  )
}
