import { NavLink, Outlet } from 'react-router-dom'
import { Alert, Layout, Menu, Statistic, Typography } from 'antd'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { seasonStore, useSeasonReadonly } from '@/stores/seasonStore'
import SeasonSwitcher from '@/components/SeasonSwitcher'

const { Sider, Header, Content } = Layout

const NAV = [
  { key: '/', label: '季内授粉安排总表' },
  { key: '/orchards', label: '果园地块管理' },
  { key: '/colonies', label: '蜂群台账' },
  { key: '/routes', label: '转场路线规划' },
  { key: '/export', label: '导出与打印' }
]

/** 应用外壳：左侧导航 + 顶部季账切换 + 封存横幅 + 路由出口 */
export default function AppLayout(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const currentSeason = usePersistentStore(seasonStore, (state) =>
    state.rows.find((item) => item.id === state.currentSeasonId)
  )
  const readonly = useSeasonReadonly()

  const totalKm = Math.round(routes.reduce((sum, item) => sum + item.distanceKm, 0) * 100) / 100

  return (
    <Layout className="app-shell">
      <Sider width={228} theme="dark" breakpoint="lg">
        <div style={{ padding: '18px 16px 12px' }}>
          <Typography.Title level={5} style={{ color: '#f5e9c8', margin: 0 }}>
            蜜蜂授粉路线规划器
          </Typography.Title>
          <Typography.Text style={{ color: '#a9b3ad', fontSize: 11 }}>Bee Pollination Router</Typography.Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          defaultSelectedKeys={['/']}
          selectedKeys={[window.location.pathname]}
          items={NAV.map((item) => ({
            key: item.key,
            label: <NavLink to={item.key}>{item.label}</NavLink>
          }))}
        />
        <div style={{ padding: 16 }}>
          <Statistic
            title={<span style={{ color: '#a9b3ad', fontSize: 12 }}>已入册地块（当季）</span>}
            value={orchards.length}
            valueStyle={{ color: '#f2c14e' }}
          />
          <Statistic
            title={<span style={{ color: '#a9b3ad', fontSize: 12 }}>蜂群 / 投放点（当季）</span>}
            value={`${colonies.length} / ${dropPoints.length}`}
            valueStyle={{ color: '#f2c14e', fontSize: 18 }}
          />
          <Statistic
            title={<span style={{ color: '#a9b3ad', fontSize: 12 }}>转场里程合计（当季）</span>}
            value={`${totalKm} km`}
            valueStyle={{ color: '#f2c14e', fontSize: 18 }}
          />
          <Typography.Paragraph style={{ color: '#7f8d82', fontSize: 11, marginTop: 12, marginBottom: 0 }}>
            数据按季建账，保存在浏览器 IndexedDB
          </Typography.Paragraph>
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #e6ecf1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 24,
            gap: 16
          }}
        >
          <Typography.Text strong>
            {currentSeason ? `当前授粉季：${currentSeason.name}` : '果园地块 → 花期 → 蜂群投放点 → 转场路线'}
          </Typography.Text>
          <SeasonSwitcher />
        </Header>
        <Content style={{ padding: 20 }}>
          {readonly ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`「${currentSeason?.name}」已封存：往季数据仅可查看与导出，不能修改`}
              description="如需调整，请用右上角季账切换器切回进行中的季，或开新季（地块与蜂群底账会带入新季，投放点与路线不带入）。"
            />
          ) : null}
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
