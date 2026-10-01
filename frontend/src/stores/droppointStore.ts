import { create } from 'zustand'
import type { DropPoint } from '@/types'
import { db, deleteRow, loadAll, putRow, requireActiveSeason } from '@/hooks/usePersistentStore'

/** 投放点提交内容（季归属由 store 补齐） */
export type DropPointDraft = Omit<DropPoint, 'seasonId'>

export interface DropPointState {
  rows: DropPoint[]
  seasonId: string
  loaded: boolean
  hydrate: (seasonId: string) => Promise<void>
  save: (draft: DropPointDraft) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByOrchard: (orchardId: string) => Promise<void>
}

export const droppointStore = create<DropPointState>((set, get) => ({
  rows: [],
  seasonId: '',
  loaded: false,
  hydrate: async (seasonId) => {
    const rows = seasonId
      ? ((await db.dropPoints.where('seasonId').equals(seasonId).toArray()) as DropPoint[])
      : await loadAll<DropPoint>(db.dropPoints)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, seasonId, loaded: true })
  },
  save: async (draft) => {
    const seasonId = await requireActiveSeason()
    await putRow<DropPoint>(db.dropPoints, { ...draft, seasonId })
    await get().hydrate(seasonId)
  },
  remove: async (id) => {
    const seasonId = await requireActiveSeason()
    await deleteRow<DropPoint>(db.dropPoints, id)
    await get().hydrate(seasonId)
  },
  removeByOrchard: async (orchardId) => {
    const seasonId = await requireActiveSeason()
    const targets = get().rows.filter((row) => row.orchardId === orchardId)
    await Promise.all(targets.map((row) => deleteRow<DropPoint>(db.dropPoints, row.id)))
    await get().hydrate(seasonId)
  }
}))
