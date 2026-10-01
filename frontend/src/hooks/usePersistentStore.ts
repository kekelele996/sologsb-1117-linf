import { useStore } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import Dexie, { type Table } from 'dexie'
import type { BeeColony, DropPoint, Orchard, Season, TransitRoute } from '@/types'
import { uid } from '@/utils/id'

/** IndexedDB 数据结构版本号 */
export const SCHEMA_VERSION = 3

export interface MetaRow {
  key: string
  value: number
}

/** Dexie 封装：果园 / 蜂群 / 投放点 / 转场路线 四张季账表 + 季表 + 元数据表 */
class BeeRouteDb extends Dexie {
  orchards!: Table<Orchard, string>
  colonies!: Table<BeeColony, string>
  dropPoints!: Table<DropPoint, string>
  routes!: Table<TransitRoute, string>
  seasons!: Table<Season, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('gbbeeroute')
    this.version(1).stores({
      orchards: 'id, name, crop',
      colonies: 'id, code, status',
      dropPoints: 'id, orchardId, code',
      routes: 'id, fromDropId, toDropId',
      meta: 'key'
    })
    // v2：投放点新增「可容纳箱数」字段，迁移时为历史投放点补齐（按 8 箱兜底）
    this.version(2)
      .stores({
        orchards: 'id, name, crop, bloomStart',
        colonies: 'id, code, status, currentOrchardId',
        dropPoints: 'id, orchardId, code, dropWindow',
        routes: 'id, fromDropId, toDropId, departAt',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        await tx
          .table<DropPoint, string>('dropPoints')
          .toCollection()
          .modify((point) => {
            if (!point.capacityBoxes) {
              point.capacityBoxes = 8
            }
          })
      })
    // v3：分季建账。四张业务表加 seasonId 按季隔离；地块 / 蜂群加 masterId 跨季相认。
    // 升级前的旧数据全部归入最早一季，一条不丢，且不混入新季的冲突与箱位核算。
    this.version(SCHEMA_VERSION)
      .stores({
        orchards: 'id, name, crop, bloomStart, seasonId, masterId',
        colonies: 'id, code, status, currentOrchardId, seasonId, masterId',
        dropPoints: 'id, orchardId, code, dropWindow, seasonId',
        routes: 'id, fromDropId, toDropId, departAt, seasonId',
        seasons: 'id, status, year',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        const seasonId = uid('season')
        const now = new Date().toISOString()

        const [orchards, dropPoints, routes] = await Promise.all([
          tx.table<Orchard, string>('orchards').toArray(),
          tx.table<DropPoint, string>('dropPoints').toArray(),
          tx.table<TransitRoute, string>('routes').toArray()
        ])

        // 从旧数据里推断最早年份，作为「最早一季」的年份
        const years: number[] = []
        const pushYear = (value?: string): void => {
          const year = Number((value ?? '').slice(0, 4))
          if (year >= 2000 && year <= 2100) years.push(year)
        }
        orchards.forEach((item) => pushYear(item.bloomStart))
        dropPoints.forEach((item) => pushYear(item.dropWindow))
        routes.forEach((item) => pushYear(item.departAt))
        const year = years.length > 0 ? Math.min(...years) : new Date().getFullYear()

        await tx.table<Season, string>('seasons').put({
          id: seasonId,
          name: `${year} 授粉季（升级导入）`,
          year,
          status: 'active',
          createdAt: now,
          note: '旧版本数据升级后归入最早一季；之后开新季只带入地块与蜂群底账'
        })

        // 旧行全部盖上当季标记；地块 / 蜂群的 masterId 取本行 id（升级后即为底账源头）
        await tx.table<Orchard, string>('orchards').toCollection().modify((item) => {
          item.seasonId = seasonId
          item.masterId = item.masterId || item.id
        })
        await tx.table<BeeColony, string>('colonies').toCollection().modify((item) => {
          item.seasonId = seasonId
          item.masterId = item.masterId || item.id
        })
        await tx.table<DropPoint, string>('dropPoints').toCollection().modify((item) => {
          item.seasonId = seasonId
        })
        await tx.table<TransitRoute, string>('routes').toCollection().modify((item) => {
          item.seasonId = seasonId
        })
      })
  }
}

export const db = new BeeRouteDb()

/** 写入当前数据结构版本号 */
export async function stampDbVersion(): Promise<void> {
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
}

/** 读取整表 */
export async function loadAll<T extends object>(table: Table<T, string>): Promise<T[]> {
  return table.toArray()
}

/** 写入一条记录 */
export async function putRow<T extends object>(table: Table<T, string>, row: T): Promise<void> {
  await table.put(row)
}

/** 删除一条记录 */
export async function deleteRow<T extends object>(table: Table<T, string>, id: string): Promise<void> {
  await table.delete(id)
}

/** Zustand store ↔ Dexie 表 的读写桥接（页面统一通过它读取 store） */
export function usePersistentStore<T extends object>(store: UseBoundStore<StoreApi<T>>): T
export function usePersistentStore<T extends object, S>(
  store: UseBoundStore<StoreApi<T>>,
  selector: (state: T) => S
): S
export function usePersistentStore<T extends object, S>(
  store: UseBoundStore<StoreApi<T>>,
  selector?: (state: T) => S
): T | S {
  return useStore(store, selector ?? ((state: T) => state as unknown as S))
}

/** 首次打开写入示例数据（一季一份账：示例数据挂在首个授粉季下） */
export async function seedDemoData(): Promise<void> {
  const count = await db.orchards.count()
  if (count > 0) return

  const year = new Date().getFullYear()
  const seasonId = uid('season')
  const now = new Date().toISOString()

  await db.seasons.put({
    id: seasonId,
    name: `${year} 春`,
    year,
    status: 'active',
    createdAt: now,
    note: '示例数据（可在右上角开新季或封存往季）'
  })

  const withSeason = <T extends { id: string }>(row: T): T & { seasonId: string; masterId: string } => ({
    ...row,
    seasonId,
    masterId: (row as { masterId?: string }).masterId || row.id
  })

  await db.orchards.bulkPut([
    withSeason({
      id: 'orc_ap',
      name: '北岭苹果园',
      crop: '苹果',
      areaMu: 120,
      longitude: 107.4132,
      latitude: 34.6128,
      bloomStart: `${year}-04-08`,
      bloomEnd: `${year}-04-18`,
      colonyIntensity: 0.1,
      ownerContact: '135****2043（周园主）',
      accessibility: '大车可达',
      historyYears: [year - 2, year - 1],
      note: '主栽富士，行距 4 m，南坡'
    }),
    withSeason({
      id: 'orc_cherry',
      name: '西沟樱桃坡',
      crop: '樱桃',
      areaMu: 46,
      longitude: 107.3755,
      latitude: 34.5891,
      bloomStart: `${year}-04-12`,
      bloomEnd: `${year}-04-21`,
      colonyIntensity: 0.2,
      ownerContact: '138****7712（李园主）',
      accessibility: '仅小车',
      historyYears: [year - 1],
      note: '坡地梯田，需小车倒运蜂箱'
    }),
    withSeason({
      id: 'orc_rape',
      name: '东滩油菜田',
      crop: '油菜',
      areaMu: 220,
      longitude: 107.4621,
      latitude: 34.6435,
      bloomStart: `${year}-03-28`,
      bloomEnd: `${year}-04-12`,
      colonyIntensity: 0.05,
      ownerContact: '137****9981（合作社）',
      accessibility: '大车可达',
      historyYears: [year - 1],
      note: '连片油菜，与苹果花期部分重叠'
    })
  ])

  await db.colonies.bulkPut([
    withSeason({
      id: 'col_001',
      code: 'Q-01',
      species: '意蜂',
      strengthFrames: 8,
      boxType: '标准继箱',
      currentOrchardId: 'orc_ap',
      status: '在园',
      lastCheckDate: `${year}-04-09`,
      healthNote: '群势稳定，子脾整齐'
    }),
    withSeason({
      id: 'col_002',
      code: 'Q-02',
      species: '意蜂',
      strengthFrames: 6,
      boxType: '标准继箱',
      currentOrchardId: 'orc_rape',
      status: '转场中',
      lastCheckDate: `${year}-04-05`,
      healthNote: '轻微螨害，转场后需治螨'
    }),
    withSeason({
      id: 'col_003',
      code: 'Q-03',
      species: '中蜂',
      strengthFrames: 4,
      boxType: '平箱',
      currentOrchardId: '',
      status: '待投放',
      lastCheckDate: `${year}-04-02`,
      healthNote: '新分群，群势偏弱'
    })
  ])

  await db.dropPoints.bulkPut([
    withSeason({
      id: 'dp_a01',
      orchardId: 'orc_ap',
      longitude: 107.4108,
      latitude: 34.6142,
      code: 'A-01',
      capacityBoxes: 8,
      shade: '北侧有防风林，午后半阴',
      waterDistance: 220,
      dropWindow: `${year}-04-07`,
      withdrawTime: `${year}-04-19`,
      owner: '周园主',
      colonyCodes: ['Q-01']
    }),
    withSeason({
      id: 'dp_b01',
      orchardId: 'orc_rape',
      longitude: 107.4598,
      latitude: 34.6411,
      code: 'B-01',
      capacityBoxes: 12,
      shade: '无遮阴，需临时搭棚',
      waterDistance: 480,
      dropWindow: `${year}-03-27`,
      withdrawTime: `${year}-04-13`,
      owner: '合作社',
      colonyCodes: ['Q-02']
    }),
    withSeason({
      id: 'dp_c01',
      orchardId: 'orc_cherry',
      longitude: 107.3741,
      latitude: 34.5902,
      code: 'C-01',
      capacityBoxes: 6,
      shade: '坡顶两株核桃树遮阴',
      waterDistance: 350,
      dropWindow: `${year}-04-11`,
      withdrawTime: `${year}-04-22`,
      owner: '李园主',
      colonyCodes: ['Q-02']
    })
  ])

  await db.routes.bulkPut([
    withSeason({
      id: 'rt_001',
      fromDropId: 'dp_b01',
      toDropId: 'dp_c01',
      distanceKm: 9.4,
      durationH: 0.54,
      vehicleType: '农用三轮',
      departAt: `${year}-04-13T06:30`,
      riskNote: '西沟坡道窄，雨天泥泞，需小车倒运',
      actualNote: '待执行'
    })
  ])
}
