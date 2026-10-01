import { useStore } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import Dexie, { type Table } from 'dexie'
import type { BeeColony, BeeColonyBase, DropPoint, Orchard, OrchardBase, Season, TransitRoute } from '@/types'
import { uid } from '@/utils/id'

/** IndexedDB 数据结构版本号 */
export const SCHEMA_VERSION = 3

/** meta 表键：当前查看 / 操作的授粉季 ID */
export const META_CURRENT_SEASON = 'currentSeasonId'

export interface MetaRow {
  key: string
  value: number | string
}

/** Dexie 封装：授粉季 + 地块/蜂群底账 + 季内四张表 + 元数据表 */
class BeeRouteDb extends Dexie {
  seasons!: Table<Season, string>
  orchardBases!: Table<OrchardBase, string>
  colonyBases!: Table<BeeColonyBase, string>
  orchards!: Table<Orchard, string>
  colonies!: Table<BeeColony, string>
  dropPoints!: Table<DropPoint, string>
  routes!: Table<TransitRoute, string>
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
    // v3：一季一份账。新增授粉季与地块/蜂群底账，所有季内表挂 seasonId；
    // 地块/蜂群季行挂 baseId 锚定同一条底账（跨季认得出）。
    this.version(SCHEMA_VERSION)
      .stores({
        seasons: 'id, status, startedAt',
        orchardBases: 'id, name, crop',
        colonyBases: 'id, code',
        orchards: 'id, seasonId, baseId, name, crop, bloomStart',
        colonies: 'id, seasonId, baseId, code, status, currentOrchardId',
        dropPoints: 'id, seasonId, orchardId, code, dropWindow',
        routes: 'id, seasonId, fromDropId, toDropId, departAt',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        // 旧数据（v1/v2）整体归入最早一季并封存：一条都不丢
        const legacyOrchards = (await tx.table('orchards').toArray()) as Orchard[]
        const legacyColonies = (await tx.table('colonies').toArray()) as BeeColony[]
        const legacyDropCount = await tx.table('dropPoints').count()
        const legacyRouteCount = await tx.table('routes').count()
        const hasLegacyData = legacyOrchards.length + legacyColonies.length + legacyDropCount + legacyRouteCount > 0

        const year = new Date().getFullYear()
        const activeId = `season_${year}`
        const nowIso = new Date().toISOString()
        const seasonsTable = tx.table<Season, string>('seasons')

        if (hasLegacyData) {
          await seasonsTable.put({
            id: 'season_legacy',
            name: '升级前历史季（最早）',
            status: 'sealed',
            // 取最小日期，保证在季列表（按开始时间升序）里始终排第一
            startedAt: '0001-01-01T00:00:00.000Z',
            sealedAt: nowIso,
            note: '由旧版数据升级归档，封存后仅可查看与导出'
          })

          // 地块底账：以旧季行 ID 作为底账 ID（首季底账与季行同号）
          await tx
            .table<OrchardBase, string>('orchardBases')
            .bulkPut(
              legacyOrchards.map((item) => ({
                id: item.id,
                name: item.name,
                crop: item.crop,
                areaMu: item.areaMu,
                longitude: item.longitude,
                latitude: item.latitude,
                ownerContact: item.ownerContact,
                accessibility: item.accessibility,
                historyYears: item.historyYears,
                note: item.note
              }))
            )

          // 蜂群底账
          await tx
            .table<BeeColonyBase, string>('colonyBases')
            .bulkPut(
              legacyColonies.map((item) => ({
                id: item.id,
                code: item.code,
                species: item.species,
                boxType: item.boxType
              }))
            )

          // 旧季行挂到封存季，baseId 锚定底账
          await tx
            .table('orchards')
            .toCollection()
            .modify((row: Orchard) => {
              row.seasonId = 'season_legacy'
              row.baseId = row.id
            })
          await tx
            .table('colonies')
            .toCollection()
            .modify((row: BeeColony) => {
              row.seasonId = 'season_legacy'
              row.baseId = row.id
            })
          await tx
            .table('dropPoints')
            .toCollection()
            .modify((row: DropPoint) => {
              row.seasonId = 'season_legacy'
            })
          await tx
            .table('routes')
            .toCollection()
            .modify((row: TransitRoute) => {
              row.seasonId = 'season_legacy'
            })
        }

        // 自动开新的当季：地块/蜂群底账带过来（花期、群势作为新季初值预填），
        // 上园状态重置；投放点与路线不带（留在封存季，不进当季冲突与箱位核算）
        await seasonsTable.put({
          id: activeId,
          name: `${year}年授粉季`,
          status: 'active',
          startedAt: nowIso,
          sealedAt: '',
          note: ''
        })

        if (hasLegacyData) {
          await tx.table<Orchard, string>('orchards').bulkPut(
            legacyOrchards.map((item) => ({
              id: uid('orc'),
              seasonId: activeId,
              baseId: item.id,
              name: item.name,
              crop: item.crop,
              areaMu: item.areaMu,
              longitude: item.longitude,
              latitude: item.latitude,
              bloomStart: item.bloomStart,
              bloomEnd: item.bloomEnd,
              colonyIntensity: item.colonyIntensity,
              ownerContact: item.ownerContact,
              accessibility: item.accessibility,
              historyYears: item.historyYears,
              note: item.note
            }))
          )
          await tx.table<BeeColony, string>('colonies').bulkPut(
            legacyColonies.map((item) => ({
              id: uid('col'),
              seasonId: activeId,
              baseId: item.id,
              code: item.code,
              species: item.species,
              boxType: item.boxType,
              strengthFrames: item.strengthFrames,
              currentOrchardId: '',
              status: '待投放',
              lastCheckDate: '',
              healthNote: ''
            }))
          )
        }

        await tx.table<MetaRow, string>('meta').put({ key: META_CURRENT_SEASON, value: activeId })
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

/** 读取当前进行中（可写）的授粉季 ID；无活动季或当前为封存季时返回 null */
export async function getActiveSeasonId(): Promise<string | null> {
  const meta = await db.meta.get(META_CURRENT_SEASON)
  if (!meta || typeof meta.value !== 'string') return null
  const season = await db.seasons.get(meta.value)
  return season && season.status === 'active' ? season.id : null
}

/** 写操作守卫：只有当季（活动季）可写；查看封存往季时直接拒绝 */
export async function requireActiveSeason(): Promise<string> {
  const id = await getActiveSeasonId()
  if (!id) {
    throw new Error('当前查看的是已封存的往季账，只能查看与导出')
  }
  return id
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

/** 首次打开写入示例数据（v3：先建当季，示例全部挂在当季） */
export async function seedDemoData(): Promise<void> {
  const seasonCount = await db.seasons.count()
  if (seasonCount > 0) return

  const year = new Date().getFullYear()
  const seasonId = `season_${year}`

  await db.transaction(
    'rw',
    [db.seasons, db.orchardBases, db.colonyBases, db.orchards, db.colonies, db.dropPoints, db.routes, db.meta],
    async () => {
      await db.seasons.put({
        id: seasonId,
        name: `${year}年授粉季`,
        status: 'active',
        startedAt: new Date().toISOString(),
        sealedAt: '',
        note: ''
      })

      await db.orchardBases.bulkPut([
        {
          id: 'orc_ap',
          name: '北岭苹果园',
          crop: '苹果',
          areaMu: 120,
          longitude: 107.4132,
          latitude: 34.6128,
          ownerContact: '135****2043（周园主）',
          accessibility: '大车可达',
          historyYears: [year - 2, year - 1],
          note: '主栽富士，行距 4 m，南坡'
        },
        {
          id: 'orc_cherry',
          name: '西沟樱桃坡',
          crop: '樱桃',
          areaMu: 46,
          longitude: 107.3755,
          latitude: 34.5891,
          ownerContact: '138****7712（李园主）',
          accessibility: '仅小车',
          historyYears: [year - 1],
          note: '坡地梯田，需小车倒运蜂箱'
        },
        {
          id: 'orc_rape',
          name: '东滩油菜田',
          crop: '油菜',
          areaMu: 220,
          longitude: 107.4621,
          latitude: 34.6435,
          ownerContact: '137****9981（合作社）',
          accessibility: '大车可达',
          historyYears: [year - 1],
          note: '连片油菜，与苹果花期部分重叠'
        }
      ])

      await db.orchards.bulkPut([
        {
          id: 'orc_ap',
          seasonId,
          baseId: 'orc_ap',
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
        },
        {
          id: 'orc_cherry',
          seasonId,
          baseId: 'orc_cherry',
          name: '西沟樱桃坡',
          crop: '樱桃',
          areaMu: 46,
          longitude: 107.3755,
          latitude: 34.5891,
          bloomStart: `${year}-04-12`,
          bloomEnd: `${year}-04-21`,
          colonyIntensity: 0.2,
          ownerContact: '138****9981（李园主）',
          accessibility: '仅小车',
          historyYears: [year - 1],
          note: '坡地梯田，需小车倒运蜂箱'
        },
        {
          id: 'orc_rape',
          seasonId,
          baseId: 'orc_rape',
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
        }
      ])

      await db.colonyBases.bulkPut([
        { id: 'col_001', code: 'Q-01', species: '意蜂', boxType: '标准继箱' },
        { id: 'col_002', code: 'Q-02', species: '意蜂', boxType: '标准继箱' },
        { id: 'col_003', code: 'Q-03', species: '中蜂', boxType: '平箱' }
      ])

      await db.colonies.bulkPut([
        {
          id: 'col_001',
          seasonId,
          baseId: 'col_001',
          code: 'Q-01',
          species: '意蜂',
          strengthFrames: 8,
          boxType: '标准继箱',
          currentOrchardId: 'orc_ap',
          status: '在园',
          lastCheckDate: `${year}-04-09`,
          healthNote: '群势稳定，子脾整齐'
        },
        {
          id: 'col_002',
          seasonId,
          baseId: 'col_002',
          code: 'Q-02',
          species: '意蜂',
          strengthFrames: 6,
          boxType: '标准继箱',
          currentOrchardId: 'orc_rape',
          status: '转场中',
          lastCheckDate: `${year}-04-05`,
          healthNote: '轻微螨害，转场后需治螨'
        },
        {
          id: 'col_003',
          seasonId,
          baseId: 'col_003',
          code: 'Q-03',
          species: '中蜂',
          strengthFrames: 4,
          boxType: '平箱',
          currentOrchardId: '',
          status: '待投放',
          lastCheckDate: `${year}-04-02`,
          healthNote: '新分群，群势偏弱'
        }
      ])

      await db.dropPoints.bulkPut([
        {
          id: 'dp_a01',
          seasonId,
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
        },
        {
          id: 'dp_b01',
          seasonId,
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
        },
        {
          id: 'dp_c01',
          seasonId,
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
        }
      ])

      await db.routes.bulkPut([
        {
          id: 'rt_001',
          seasonId,
          fromDropId: 'dp_b01',
          toDropId: 'dp_c01',
          distanceKm: 9.4,
          durationH: 0.54,
          vehicleType: '农用三轮',
          departAt: `${year}-04-13T06:30`,
          riskNote: '西沟坡道窄，雨天泥泞，需小车倒运',
          actualNote: '待执行'
        }
      ])

      await db.meta.put({ key: META_CURRENT_SEASON, value: seasonId })
    }
  )
}
