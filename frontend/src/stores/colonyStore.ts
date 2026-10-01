import { create } from 'zustand'
import type { BeeColony, ColonyStatus } from '@/types'
import { db, deleteRow, loadAll, putRow, requireActiveSeason } from '@/hooks/usePersistentStore'

/** 蜂群编辑/新增提交的内容（季归属与底账 ID 由 store 补齐） */
export type ColonyDraft = Omit<BeeColony, 'seasonId' | 'baseId'>

export interface ColonyState {
  rows: BeeColony[]
  seasonId: string
  loaded: boolean
  hydrate: (seasonId: string) => Promise<void>
  save: (draft: ColonyDraft) => Promise<void>
  remove: (id: string) => Promise<void>
  bulkSetStatus: (ids: string[], status: ColonyStatus) => Promise<void>
  bulkSetHealthNote: (ids: string[], note: string, checkDate: string) => Promise<void>
}

export const colonyStore = create<ColonyState>((set, get) => ({
  rows: [],
  seasonId: '',
  loaded: false,
  hydrate: async (seasonId) => {
    const rows = seasonId
      ? ((await db.colonies.where('seasonId').equals(seasonId).toArray()) as BeeColony[])
      : await loadAll<BeeColony>(db.colonies)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, seasonId, loaded: true })
  },
  save: async (draft) => {
    const seasonId = await requireActiveSeason()
    const existing = draft.id ? get().rows.find((item) => item.id === draft.id) : undefined
    // 编辑：沿用本季行锚定的底账；新增：同群号底账存在则认回同一条，否则新建底账
    let baseId = existing?.baseId ?? ''
    if (!baseId) {
      const sameBase = await db.colonyBases.where('code').equals(draft.code).first()
      baseId = sameBase?.id ?? draft.id
    }
    const row: BeeColony = { ...draft, seasonId, baseId }
    await putRow<BeeColony>(db.colonies, row)
    // 底账只跟身份字段（当季改群势、状态、检查备注不写底账，也不碰往季行）
    await db.colonyBases.put({ id: baseId, code: row.code, species: row.species, boxType: row.boxType })
    await get().hydrate(seasonId)
  },
  remove: async (id) => {
    const seasonId = await requireActiveSeason()
    await deleteRow<BeeColony>(db.colonies, id)
    await get().hydrate(seasonId)
  },
  bulkSetStatus: async (ids, status) => {
    const seasonId = await requireActiveSeason()
    const targets = get().rows.filter((row) => ids.includes(row.id))
    await Promise.all(targets.map((row) => putRow<BeeColony>(db.colonies, { ...row, status })))
    await get().hydrate(seasonId)
  },
  bulkSetHealthNote: async (ids, note, checkDate) => {
    const seasonId = await requireActiveSeason()
    const targets = get().rows.filter((row) => ids.includes(row.id))
    await Promise.all(targets.map((row) => putRow<BeeColony>(db.colonies, { ...row, healthNote: note, lastCheckDate: checkDate })))
    await get().hydrate(seasonId)
  }
}))
