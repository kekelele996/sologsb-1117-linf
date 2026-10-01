import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AppRoutes } from '@/router'
import { seedDemoData, stampDbVersion } from '@/hooks/usePersistentStore'
import { seasonStore } from '@/stores/seasonStore'
import { rehydrateSeasonStores } from '@/hooks/useSeason'
import '@/styles/index.css'

/** 启动：写入示例数据（仅首次）→ 记录 schemaVersion → 定季 → 按当前季水合各 store */
async function bootstrap(): Promise<void> {
  await seedDemoData()
  await stampDbVersion()
  await seasonStore.getState().hydrate()
  await rehydrateSeasonStores(seasonStore.getState().currentSeasonId)
}

void bootstrap()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
)
