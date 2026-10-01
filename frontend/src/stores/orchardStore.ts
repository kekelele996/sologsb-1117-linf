import { create } from 'zustand'
import type { Orchard } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'
import { assertWritableSeason, seasonStore } from './seasonStore'

export interface OrchardState {
  rows: Orchard[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: Orchard) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const orchardStore = create<OrchardState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const seasonId = seasonStore.getState().currentSeasonId
    const rows = seasonId
      ? await db.orchards.where('seasonId').equals(seasonId).toArray()
      : await loadAll<Orchard>(db.orchards)
    rows.sort((a, b) => a.bloomStart.localeCompare(b.bloomStart))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    assertWritableSeason()
    const seasonId = seasonStore.getState().currentSeasonId
    await putRow<Orchard>(db.orchards, {
      ...row,
      seasonId: row.seasonId || seasonId,
      masterId: row.masterId || uid('m_orc')
    })
    await get().hydrate()
  },
  remove: async (id) => {
    assertWritableSeason()
    await deleteRow<Orchard>(db.orchards, id)
    await get().hydrate()
  }
}))
