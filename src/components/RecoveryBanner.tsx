import { useEffect, useRef } from 'react'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import ResumeIcon from '@mui/icons-material/PlayCircleOutline'
import { Link } from 'react-router-dom'
import {
  useGetRecoverableOperationsQuery,
  useGetSettingsQuery,
  useResumeAllOperationsMutation,
  useResumeOperationMutation,
  useSetFailureSimulationMutation,
} from '@/services/flagApi'

/**
 * 全局操作恢复条：
 * - 打开应用时自动继续仍在处理中的批量操作；
 * - 写入失败的操作保留未完成项，可在此逐项重试或关闭演练开关后继续；
 * - “重开仍能接着处理”由持久化队列 + 启动恢复共同保证。
 */
export function RecoveryBanner() {
  const { data: operations = [] } = useGetRecoverableOperationsQuery(undefined, {
    pollingInterval: 1500,
  })
  const { data: settings } = useGetSettingsQuery()
  const [resumeOperation, resumeState] = useResumeOperationMutation()
  const [resumeAll, resumeAllState] = useResumeAllOperationsMutation()
  const [setFailureSimulation] = useSetFailureSimulationMutation()
  const autoRecovered = useRef(false)

  const pendingOperations = operations.filter((operation) =>
    operation.items.some((item) => item.status === 'pending'),
  )
  const failedOperations = operations.filter((operation) =>
    operation.items.some((item) => item.status === 'failed'),
  )

  // 重开应用：自动接着处理未完成（pending）项，failed 项保留给人工确认。
  useEffect(() => {
    if (pendingOperations.length > 0 && !autoRecovered.current && !settings?.simulateFailures) {
      autoRecovered.current = true
      void resumeAll()
    }
  }, [pendingOperations.length, resumeAll, settings?.simulateFailures])

  if (operations.length === 0 && !settings?.simulateFailures) return null

  const busy = resumeState.isLoading || resumeAllState.isLoading

  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      {settings?.simulateFailures && (
        <Alert severity="warning" variant="outlined">
          <AlertTitle>演练模式：存储写入失败已开启</AlertTitle>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ md: 'center' }}
            justifyContent="space-between"
          >
            <Typography variant="body2">
              主数据库写入将被拒绝，用于验证批量操作“失败后保留未完成项、可重试、重开接着处理”。
              批量操作队列保存在独立存储中，不受影响。
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.simulateFailures}
                  onChange={(event) => void setFailureSimulation(event.target.checked)}
                />
              }
              label="模拟写入失败"
            />
          </Stack>
        </Alert>
      )}

      {operations.length > 0 && (
        <Alert
          severity={failedOperations.length > 0 ? 'error' : 'info'}
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              {failedOperations.length > 0 && settings?.simulateFailures && (
                <Button
                  size="small"
                  onClick={() => void setFailureSimulation(false)}
                >
                  关闭演练后写入即可恢复
                </Button>
              )}
              {failedOperations.length > 0 && (
                <Button
                  size="small"
                  variant="contained"
                  color="inherit"
                  startIcon={<ResumeIcon />}
                  disabled={busy || settings?.simulateFailures}
                  onClick={() => void resumeAll()}
                >
                  重试全部未完成项
                </Button>
              )}
              <Button component={Link} to="/reports" size="small" color="inherit">
                查看操作报告
              </Button>
            </Stack>
          }
        >
          <AlertTitle>
            {failedOperations.length > 0
              ? `${failedOperations.length} 个批量操作存在写入失败的未完成项`
              : `${pendingOperations.length} 个批量操作正在恢复处理`}
          </AlertTitle>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {operations.slice(0, 4).map((operation) => {
              const done = operation.items.filter((item) => item.status === 'done').length
              const failed = operation.items.filter((item) => item.status === 'failed').length
              const pending = operation.items.length - done - failed
              return (
                <Stack key={operation.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography variant="body2" fontWeight={700}>{operation.title}</Typography>
                  <Chip size="small" label={`${done}/${operation.items.length} 已完成`} variant="outlined" />
                  {pending > 0 && <Chip size="small" color="info" label={`${pending} 待处理`} />}
                  {failed > 0 && <Chip size="small" color="error" label={`${failed} 失败待重试`} />}
                  {failed > 0 && (
                    <Button
                      size="small"
                      disabled={busy || settings?.simulateFailures}
                      onClick={() => void resumeOperation(operation.id)}
                    >
                      继续此项
                    </Button>
                  )}
                </Stack>
              )
            })}
          </Box>
        </Alert>
      )}
    </Stack>
  )
}
