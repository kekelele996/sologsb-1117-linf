import { create } from 'zustand'
import type { Orchard } from '@/types'
import { db, deleteRow, loadAll, putRow, requireActiveSeason } from '@/hooks/usePersistentStore'

/** 地块编辑/新增提交的内容（季归属与底账 ID 由 store 补齐） */
export type OrchardDraft = Omit<Orchard, 'seasonId' | 'baseId'>

export interface OrchardState {
  rows: Orchard[]
  seasonId: string
  loaded: boolean
  hydrate: (seasonId: string) => Promise<void>
  save: (draft: OrchardDraft) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const orchardStore = create<OrchardState>((set, get) => ({
  rows: [],
  seasonId: '',
  loaded: false,
  hydrate: async (seasonId) => {
    const rows = seasonId
      ? ((await db.orchards.where('seasonId').equals(seasonId).toArray()) as Orchard[])
      : await loadAll<Orchard>(db.orchards)
    rows.sort((a, b) => a.bloomStart.localeCompare(b.bloomStart))
    set({ rows, seasonId, loaded: true })
  },
  save: async (draft) => {
    const seasonId = await requireActiveSeason()
    // 编辑同季行：底账锚点不变；新增：建一条新底账
    const existing = draft.id ? get().rows.find((item) => item.id === draft.id) : undefined
    const baseId = existing?.baseId ?? draft.id
    const row: Orchard = { ...draft, seasonId, baseId }
    await putRow<Orchard>(db.orchards, row)
    // 底账只跟身份/档案字段（当季改花期、需蜂强度不写底账，更不碰往季行）
    await db.orchardBases.put({
      id: baseId,
      name: row.name,
      crop: row.crop,
      areaMu: row.areaMu,
      longitude: row.longitude,
      latitude: row.latitude,
      ownerContact: row.ownerContact,
      accessibility: row.accessibility,
      historyYears: row.historyYears,
      note: row.note
    })
    await get().hydrate(seasonId)
  },
  remove: async (id) => {
    const seasonId = await requireActiveSeason()
    await deleteRow<Orchard>(db.orchards, id)
    await get().hydrate(seasonId)
  }
}))
