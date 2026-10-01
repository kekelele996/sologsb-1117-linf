import { create } from 'zustand'
import type { DropPoint } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { assertWritableSeason, seasonStore } from './seasonStore'

export interface DropPointState {
  rows: DropPoint[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: DropPoint) => Promise<void>
  remove: (id: string) => Promise<void>
  removeByOrchard: (orchardId: string) => Promise<void>
}

export const droppointStore = create<DropPointState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const seasonId = seasonStore.getState().currentSeasonId
    const rows = seasonId
      ? await db.dropPoints.where('seasonId').equals(seasonId).toArray()
      : await loadAll<DropPoint>(db.dropPoints)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    assertWritableSeason()
    const seasonId = seasonStore.getState().currentSeasonId
    await putRow<DropPoint>(db.dropPoints, { ...row, seasonId: row.seasonId || seasonId })
    await get().hydrate()
  },
  remove: async (id) => {
    assertWritableSeason()
    await deleteRow<DropPoint>(db.dropPoints, id)
    await get().hydrate()
  },
  removeByOrchard: async (orchardId) => {
    assertWritableSeason()
    const targets = get().rows.filter((row) => row.orchardId === orchardId)
    await Promise.all(targets.map((row) => deleteRow<DropPoint>(db.dropPoints, row.id)))
    await get().hydrate()
  }
}))
