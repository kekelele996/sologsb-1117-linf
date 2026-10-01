# 蜜蜂授粉路线规划器（gbbeeroute）

面向果园托管服务队与蜂场技术员，把「果园地块 → 花期 → 蜂群投放点 → 转场路线」排成季内可执行的授粉安排，解决花期重叠时蜂群撞车、转场距离过远、投放点与地块不匹配的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21817>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbbeeroute
FRONTEND_PORT=21817
VITE_AMAP_KEY=            # 可选，留空即自动降级为本地 SVG 网格视图
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| UI 组件库 | Ant Design 5 |
| 地图 | 高德地图 JS API 2.0（可选，key 走 `VITE_AMAP_KEY`） |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移，v3 起一季一份账） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、高德地图 Key 与降级策略

- 在 `.env` 里填写 `VITE_AMAP_KEY=<你的 key>` 后**重新构建**（`docker compose up -d --build`），地图将使用高德 JS API 渲染地块、投放点与转场折线；
- **未配置 key 或脚本加载失败时，`RouteMap` 自动降级为本地 SVG 网格视图**：按经纬度线性映射渲染地块、投放点与转场折线，支持点选拾取坐标；
- **构建与运行都不依赖该 key**：未配置 key 时不会注入任何外部脚本（避免无谓请求与报错），Docker 构建零网络依赖即可通过；
- 页面右上角始终显示当前数据源（高德地图 JS API / 本地 SVG 网格视图）。

## 四、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21817
npm run build      # 类型检查 + 生产构建
```

## 五、目录结构

```
sologsb-1117/
├── docker-compose.yml          # 顶层 name: gbbeeroute，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # season.ts / orchard.ts / colony.ts / droppoint.ts / route.ts / index.ts
│       ├── stores/             # seasonStore / orchardStore / colonyStore / droppointStore / routeStore（Zustand）
│       ├── components/common/  # RouteMap / FlowerWindowBar / StatusTag / CoordPicker / SeasonSwitcher
│       ├── hooks/              # useAmap / usePersistentStore / useSeason
│       ├── pages/              # SchedulePage / OrchardsPage / ColoniesPage / RoutesPage / ExportPage
│       ├── router/index.tsx
│       └── utils/              # geo.ts / export.ts / id.ts
└── frontend/scripts/verify-seasons.ts   # 数据层端到端断言（v2→v3 迁移 / 开季 / 封存只读，`npm run verify:seasons`）
```

## 六、数据模型与授粉季账套（一季一份账）

蜂场以「授粉季」为周期作业。**每个授粉季是一份独立的账**，顶栏的授粉季切换器用于选择查看与开季，规则如下：

| 规则 | 实现 |
| --- | --- |
| 一季一份账 | 新增 `seasons` 表（`active` 进行中 / `sealed` 已封存）；地块季行、蜂群季行、投放点、路线全部挂 `seasonId` |
| 开季只带底账 | 开新季时封存旧当季、新建活动季：**地块底账带过来（花期作为新季初值预填）、蜂群底账带过来（群势预填，上园状态重置为「待投放」，清空当前地块/检查记录）**；**投放点与转场路线不带** |
| 跨季认得出同一条底账 | 地块与蜂群各有独立底账表（`orchardBases` / `colonyBases`）；季行用 `baseId` 锚定底账，新季节行重新发号但 `baseId` 沿用，跨季仍能认出是同一地块 / 同一群 |
| 当季改不影响往季 | 季行是整行快照：当季改花期、需蜂强度、群势只改当季行；底账只跟身份/档案字段（地块名、面积、坐标、群号、蜂种、箱型），**封存季行永不被改写** |
| 地块 / 蜂群各自维护 | 底账分两张表，互不引用；群号是蜂群底账身份（当季按同号认回同一群） |
| 旧数据升级不丢不混 | v2→v3 迁移把所有旧数据（含投放点、路线）整体归入封存季 `season_legacy`（季列表中永远排第一），同时自动开一个只带底账的活动新季；旧投放点/路线不进当季，因此**不会混进当季的冲突判定与箱位核算** |
| 封存后只能看和导出 | 封存季所有写操作（地块/蜂群/投放点/路线增删改、批量操作、生成路线）UI 禁用且数据层 `requireActiveSeason` 守卫拒绝；查看、打印、CSV/JSON 导出仍可用，导出为当前季自包含账 |

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Season 授粉季 | 季名、状态（进行中/已封存）、开季/封存时间 | `seasons` |
| OrchardBase 地块底账 | 跨季档案：地块名、作物、面积、经纬度、园主、可达性、历史年份、备注 | `orchardBases` |
| BeeColonyBase 蜂群底账 | 跨季身份：群号、蜂种、箱型 | `colonyBases` |
| Orchard 地块（当季） | 底账快照 + 当季盛花期起止、需蜂强度 | `orchards`（`seasonId` + `baseId`） |
| BeeColony 蜂群（当季） | 底账快照 + 当季群势、当前所在地块、状态、检查日期、健康备注 | `colonies`（`seasonId` + `baseId`） |
| DropPoint 投放点 | 所属地块、坐标、编号、可容纳箱数、遮阴条件、水源距离、投放时间窗、撤场时间、责任人、安排群号 | `dropPoints`（`seasonId`） |
| TransitRoute 转场路线 | 出发/到达投放点、预计里程与耗时、车辆类型、出发时刻、风险备注、实际记录 | `routes`（`seasonId`） |

- 数据库名 `gbbeeroute`，`meta` 表保存 `schemaVersion` 与当前查看季 `currentSeasonId`；
- `version(2)` 为历史投放点补齐「可容纳箱数」（默认 8 箱）；`version(3)` 建立季账套、写 `seasonId` / `baseId` 并完成旧数据归档（规则见上表）；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 七、主要页面

| 路由 | 功能 |
| --- | --- |
| `/` | 季内授粉安排总表：花期条带 + 已投放群体，冲突（同一蜂群被排入花期重叠的不同地块）标红并汇总 |
| `/orchards` | 果园地块管理：面积与需蜂强度自动算建议箱数、可达性标记、花期重叠提示、投放点维护（含坐标拾取） |
| `/colonies` | 蜂群台账：按群势与状态筛选，批量改状态、批量记录检查备注 |
| `/routes` | 转场路线规划：地图依次选点生成顺序与里程，拖动或上下移动调整顺序并实时重算，写回路线表 |
| `/export` | 导出当前授粉季的授粉安排清单 / 转场路线表（CSV）、自包含季账 JSON，并提供横向/纵向打印视图（封存季同样可导出） |

## 八、计算约定

- 建议箱数 = ⌈面积(亩) × 需蜂强度(箱/亩)⌉，最少 1 箱；
- 转场里程按 Haversine 球面距离累计，耗时按平均 32 km/h + 0.25 h 装卸估算；
- 花期重叠：两地块盛花期区间交集天数 ≥ 1 即视为重叠；同一群号在重叠期内被排入两个地块 → 冲突。
