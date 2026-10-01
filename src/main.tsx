import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { RouterProvider } from 'react-router-dom'
import { store } from '@/app/store'
import { theme } from '@/app/theme'
import { router } from '@/app/router'
import { resumeOutbox } from '@/services/database'
import '@/styles.css'

// 重开页面时自动续跑：把上次未完成的多开关 / 审计 / 报告写入从断点继续处理
resumeOutbox()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <RouterProvider router={router} />
      </ThemeProvider>
    </Provider>
  </React.StrictMode>,
)
