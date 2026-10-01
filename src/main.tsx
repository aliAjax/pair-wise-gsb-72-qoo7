import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { RouterProvider } from 'react-router-dom'
import { store } from '@/app/store'
import { theme } from '@/app/theme'
import { router } from '@/app/router'
import { reconcileOnStartup } from '@/services/database'
import '@/styles.css'

// 启动时复核：前置暂停、互斥后启用、配置改动会立即使相关批准失效并退回待复核。
reconcileOnStartup()

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
