import { create } from 'zustand'
import type { BeeColony, Orchard, Season } from '@/types'
import { db, loadAll, META_CURRENT_SEASON, putRow } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'

export interface SeasonState {
  rows: Season[]
  currentSeasonId: string
  currentSeason: Season | null
  loaded: boolean
  hydrate: () => Promise<void>
  /** 切换正在查看的授粉季（活动季可写，封存季只读） */
  switchSeason: (seasonId: string) => Promise<void>
  /**
   * 开新季：封存旧当季 → 新建活动季。
   * 地块底账带过来（花期作为新季初值预填），蜂群底账带过来（群势预填、上园状态重置）；
   * 投放点与路线不结转。
   */
  openNextSeason: (name: string, note?: string) => Promise<void>
  /** 封存当前活动季（封存后只能看和导出） */
  sealCurrentSeason: () => Promise<void>
}

function findActive(rows: Season[]): Season | undefined {
  return rows.find((item) => item.status === 'active')
}

export const seasonStore = create<SeasonState>((set, get) => ({
  rows: [],
  currentSeasonId: '',
  currentSeason: null,
  loaded: false,

  hydrate: async () => {
    const [rows, meta] = await Promise.all([loadAll<Season>(db.seasons), db.meta.get(META_CURRENT_SEASON)])
    rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    const currentSeasonId =
      typeof meta?.value === 'string' && rows.some((item) => item.id === meta.value)
        ? meta.value
        : findActive(rows)?.id ?? rows[0]?.id ?? ''
    set({ rows, currentSeasonId, currentSeason: rows.find((item) => item.id === currentSeasonId) ?? null, loaded: true })
  },

  switchSeason: async (seasonId) => {
    await db.meta.put({ key: META_CURRENT_SEASON, value: seasonId })
    await get().hydrate()
  },

  openNextSeason: async (name, note = '') => {
    const { currentSeason, rows } = get()
    const newId = uid('season')
    const nowIso = new Date().toISOString()

    await db.transaction(
      'rw',
      [db.seasons, db.orchards, db.colonies, db.meta],
      async () => {
        // 同一时间最多一个活动季：开季前封存旧当季（存在则封）
        const active = currentSeason?.status === 'active' ? currentSeason : findActive(rows)
        if (active) {
          await db.seasons.put({ ...active, status: 'sealed', sealedAt: nowIso })
        }

        // 新季的底账来源：优先旧当季；没有活动季（如首次开季）时取最新一季
        const sourceId = active?.id ?? rows[rows.length - 1]?.id ?? ''
        const sourceOrchards = sourceId
          ? ((await db.orchards.where('seasonId').equals(sourceId).toArray()) as Orchard[])
          : []
        const sourceColonies = sourceId
          ? ((await db.colonies.where('seasonId').equals(sourceId).toArray()) as BeeColony[])
          : []

        const newSeason: Season = { id: newId, name: name.trim() || '未命名授粉季', status: 'active', startedAt: nowIso, sealedAt: '', note }
        await db.seasons.put(newSeason)

        // 地块：整行复制（花期 / 需蜂强度作为新季初值，当季可改且不影响往季）
        await db.orchards.bulkPut(
          sourceOrchards.map((item): Orchard => ({
            ...item,
            id: uid('orc'),
            seasonId: newId,
            // baseId 保留 → 跨季认得出是同一条地块底账
            baseId: item.baseId
          }))
        )

        // 蜂群：底账与群势带过来；上园状态 / 检查备注等季内状态不结转
        await db.colonies.bulkPut(
          sourceColonies.map((item): BeeColony => ({
            ...item,
            id: uid('col'),
            seasonId: newId,
            // baseId 保留 → 跨季认得出是同一群
            baseId: item.baseId,
            currentOrchardId: '',
            status: '待投放',
            lastCheckDate: '',
            healthNote: ''
          }))
        )

        // 投放点 / 路线：开季不复制（往季那份继续随封存季保存，只能看和导出）

        await db.meta.put({ key: META_CURRENT_SEASON, value: newId })
      }
    )

    await get().hydrate()
  },

  sealCurrentSeason: async () => {
    const { currentSeason } = get()
    if (!currentSeason || currentSeason.status !== 'active') return
    await putRow<Season>(db.seasons, { ...currentSeason, status: 'sealed', sealedAt: new Date().toISOString() })
    await get().hydrate()
  }
}))
