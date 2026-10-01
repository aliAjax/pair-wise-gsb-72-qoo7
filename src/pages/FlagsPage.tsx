import { useState } from 'react'
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
  InputAdornment,
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
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import FilterAltOffOutlinedIcon from '@mui/icons-material/FilterAltOffOutlined'
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined'
import { Link, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import {
  setEnvironmentFilter,
  setKeyword,
  setStatusFilter,
  setTeamFilter,
} from '@/app/uiSlice'
import {
  useBatchOperationMutation,
  useGetFlagsQuery,
  useGetSettingsQuery,
  useSetFailureSimulationMutation,
} from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'
import type { Environment, FlagStatus } from '@/types'

const teams = ['交易体验', '增长算法', '云控制台', '支付平台', '数据平台', '增长运营', '基础架构']

type BatchKind = 'batch-freeze' | 'batch-rollback' | 'batch-supplement-metric'

const batchConfig: Record<BatchKind, { title: string; label: string; color: 'warning' | 'error' | 'info'; needMetrics: boolean }> = {
  'batch-freeze': { title: '批量冻结流量', label: '批量冻结', color: 'warning', needMetrics: false },
  'batch-rollback': { title: '批量紧急回滚', label: '批量回滚', color: 'error', needMetrics: false },
  'batch-supplement-metric': { title: '批量补充监控', label: '批量补监控', color: 'info', needMetrics: true },
}

export function FlagsPage() {
  const dispatch = useAppDispatch()
  const filters = useAppSelector((state) => state.ui.flagFilters)
  const navigate = useNavigate()
  const { data: flags, isLoading } = useGetFlagsQuery(filters)
  const { data: settings } = useGetSettingsQuery()
  const [setFailureSimulation] = useSetFailureSimulationMutation()
  const [batchOperation, batchState] = useBatchOperationMutation()
  const [selected, setSelected] = useState<string[]>([])
  const [dialogKind, setDialogKind] = useState<BatchKind | null>(null)
  const [reason, setReason] = useState('')
  const [metrics, setMetrics] = useState('')
  const [message, setMessage] = useState('')

  const resetFilters = () => {
    dispatch(setKeyword(''))
    dispatch(setStatusFilter(''))
    dispatch(setEnvironmentFilter(''))
    dispatch(setTeamFilter(''))
  }

  const visibleIds = flags?.map((flag) => flag.id) ?? []
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))

  const toggleAll = () => {
    if (allSelected) setSelected((current) => current.filter((id) => !visibleIds.includes(id)))
    else setSelected((current) => [...new Set([...current, ...visibleIds])])
  }

  const toggleOne = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const submitBatch = async () => {
    if (!dialogKind || selected.length === 0) return
    if (reason.trim().length < 8) {
      setMessage('操作原因至少 8 个字符')
      return
    }
    const metricList = metrics.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
    if (batchConfig[dialogKind].needMetrics && metricList.length === 0) {
      setMessage('请填写至少一个要补充的监控指标')
      return
    }
    try {
      const operation = await batchOperation({
        kind: dialogKind,
        ids: selected,
        actor: '林默',
        reason,
        metrics: metricList,
      }).unwrap()
      const failed = operation.items.filter((item) => item.status !== 'done').length
      setDialogKind(null)
      setReason('')
      setMetrics('')
      setMessage(
        failed > 0
          ? `操作 ${operation.items.length - failed}/${operation.items.length} 完成，未完成项已保留，可在页面顶部或发布报告中重试`
          : `操作已全部完成（${operation.items.length} 个开关），审计和操作报告已生成`,
      )
      setSelected([])
    } catch (error) {
      const apiError = error as { data?: { message?: string } }
      setMessage(apiError?.data?.message ?? '批量操作提交失败，请重试')
    }
  }

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">功能开关工作区</Typography>
          <Typography color="text.secondary">
            维护状态、受众、客户端版本、依赖与回滚条件；可批量冻结、回滚或补监控，一次操作联动多个开关、审计和报告。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={settings?.simulateFailures ?? false}
                onChange={(event) => void setFailureSimulation(event.target.checked)}
              />
            }
            label={<Typography variant="caption">演练写入失败</Typography>}
          />
          <Button component={Link} to="/flags/new" variant="contained" startIcon={<AddIcon />}>
            新建开关
          </Button>
        </Stack>
      </Box>

      {message && (
        <Alert severity={message.includes('失败') || message.includes('不能') || message.includes('至少') ? 'error' : 'success'} onClose={() => setMessage('')} sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}

      {selected.length > 0 && (
        <Alert
          icon={false}
          sx={{ mb: 2 }}
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" color="warning" startIcon={<PauseCircleOutlineIcon />} onClick={() => { setReason('冻结窗口观察核心指标，暂停扩大流量。'); setDialogKind('batch-freeze') }}>
                {batchConfig['batch-freeze'].label}
              </Button>
              <Button size="small" color="info" startIcon={<MonitorHeartOutlinedIcon />} onClick={() => { setReason('冻结窗口内补充守护监控指标。'); setDialogKind('batch-supplement-metric') }}>
                {batchConfig['batch-supplement-metric'].label}
              </Button>
              <Button size="small" color="error" startIcon={<UndoOutlinedIcon />} onClick={() => { setReason('生产异常触发批量人工回滚，停止继续放量。'); setDialogKind('batch-rollback') }}>
                {batchConfig['batch-rollback'].label}
              </Button>
              <Button size="small" onClick={() => setSelected([])}>取消选择</Button>
            </Stack>
          }
        >
          已选择 <b>{selected.length}</b> 个开关，一次操作会逐项写入开关、审计并生成可归档的操作报告。
        </Alert>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box className="filter-grid">
            <TextField
              value={filters.keyword}
              onChange={(event) => dispatch(setKeyword(event.target.value))}
              placeholder="名称、Key 或负责人"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              value={filters.status}
              onChange={(event) => dispatch(setStatusFilter(event.target.value as FlagStatus | ''))}
              label="状态"
            >
              <MenuItem value="">全部状态</MenuItem>
              <MenuItem value="draft">草稿</MenuItem>
              <MenuItem value="review">待评审</MenuItem>
              <MenuItem value="active">已发布</MenuItem>
              <MenuItem value="frozen">已冻结</MenuItem>
              <MenuItem value="rolled-back">已回滚</MenuItem>
            </TextField>
            <TextField
              select
              value={filters.environment}
              onChange={(event) => dispatch(setEnvironmentFilter(event.target.value as Environment | ''))}
              label="环境"
            >
              <MenuItem value="">全部环境</MenuItem>
              <MenuItem value="dev">开发</MenuItem>
              <MenuItem value="staging">预发</MenuItem>
              <MenuItem value="production">生产</MenuItem>
            </TextField>
            <TextField
              select
              value={filters.team}
              onChange={(event) => dispatch(setTeamFilter(event.target.value))}
              label="团队"
            >
              <MenuItem value="">全部团队</MenuItem>
              {teams.map((team) => (
                <MenuItem key={team} value={team}>
                  {team}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5 }}>
            <Button startIcon={<FilterAltOffOutlinedIcon />} onClick={resetFilters}>
              重置条件
            </Button>
            <Typography variant="caption" color="text.secondary">
              共 {flags?.length ?? 0} 个开关
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox checked={allSelected} onChange={toggleAll} indeterminate={selected.length > 0 && !allSelected} />
                </TableCell>
                <TableCell>功能开关</TableCell>
                <TableCell>环境 / 状态</TableCell>
                <TableCell>当前放量</TableCell>
                <TableCell>受众条件</TableCell>
                <TableCell>依赖与风险</TableCell>
                <TableCell>负责人</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {flags?.map((flag) => (
                <TableRow key={flag.id} hover selected={selected.includes(flag.id)}>
                  <TableCell padding="checkbox">
                    <Checkbox checked={selected.includes(flag.id)} onChange={() => toggleOne(flag.id)} />
                  </TableCell>
                  <TableCell>
                    <Typography component={Link} to={`/flags/${flag.id}`} fontWeight={700} variant="body2">
                      {flag.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {flag.key}
                    </Typography>
                    {flag.approval && !flag.approval.valid && (
                      <Chip size="small" color="error" variant="outlined" label="批准失效待复核" sx={{ mt: 0.5 }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.6} alignItems="flex-start">
                      <Chip label={flag.environment.toUpperCase()} size="small" variant="outlined" />
                      <FlagStatusChip status={flag.status} />
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight={700}>{flag.rolloutPercentage}%</Typography>
                    <Typography variant="caption" color="text.secondary">
                      最低客户端 {flag.minClientVersion[flag.environment]}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{flag.audienceRules.length} 条规则</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {flag.regions.join('、')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{flag.dependencies.length} 个依赖</Typography>
                    <Typography variant="caption" color={flag.deadCodeStatus === 'confirmed' ? 'error.main' : 'text.secondary'}>
                      死代码：{flag.deadCodeStatus === 'clean' ? '无' : flag.deadCodeStatus === 'candidate' ? '候选' : '已确认'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{flag.owner}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {flag.team}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => navigate(`/flags/${flag.id}`)}
                    >
                      编辑
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && flags?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6 }} color="text.secondary">
                    当前筛选条件下没有功能开关
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={dialogKind !== null} onClose={() => setDialogKind(null)} fullWidth maxWidth="sm">
        {dialogKind && (
          <>
            <DialogTitle>{batchConfig[dialogKind].title}（{selected.length} 个开关）</DialogTitle>
            <DialogContent dividers>
              {dialogKind === 'batch-rollback' && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  将逐项关闭所选开关、灰度降至 0；每项写入独立审计，整体生成操作报告。写入失败的项会保留未完成状态，可重试，重开页面仍可继续。
                </Alert>
              )}
              {dialogKind === 'batch-freeze' && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  冻结后运行中阶段暂停，冻结过去前不能扩量，只能回滚或补监控。
                </Alert>
              )}
              {dialogKind === 'batch-supplement-metric' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  只追加监控指标，不改变配置基线、不使发布批准失效。
                  <TextField
                    sx={{ mt: 2 }}
                    label="监控指标（逗号或换行分隔）"
                    multiline
                    minRows={2}
                    fullWidth
                    value={metrics}
                    onChange={(event) => setMetrics(event.target.value)}
                    placeholder="gateway_timeout_rate, order_drop_rate"
                  />
                </Alert>
              )}
              <TextField
                label="操作原因"
                multiline
                minRows={3}
                fullWidth
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDialogKind(null)}>取消</Button>
              <Button
                variant="contained"
                color={batchConfig[dialogKind].color === 'info' ? 'primary' : batchConfig[dialogKind].color}
                loading={batchState.isLoading}
                onClick={() => void submitBatch()}
              >
                确认{batchConfig[dialogKind].label}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  )
}
