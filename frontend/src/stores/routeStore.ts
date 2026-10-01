import { create } from 'zustand'
import type { TransitRoute } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { distanceKm, estimateDurationH } from '@/utils/geo'
import { assertWritableSeason, seasonStore } from './seasonStore'

export interface RouteState {
  rows: TransitRoute[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: TransitRoute) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 按选点顺序重排并重算里程 / 耗时，生成连续转场段 */
  rebuildFromOrder: (
    orderedDropIds: string[],
    meta: { vehicleType: TransitRoute['vehicleType']; departAt: string; riskNote: string }
  ) => Promise<void>
}

export const routeStore = create<RouteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const seasonId = seasonStore.getState().currentSeasonId
    const rows = seasonId
      ? await db.routes.where('seasonId').equals(seasonId).toArray()
      : await loadAll<TransitRoute>(db.routes)
    rows.sort((a, b) => a.departAt.localeCompare(b.departAt))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    assertWritableSeason()
    const seasonId = seasonStore.getState().currentSeasonId
    await putRow<TransitRoute>(db.routes, { ...row, seasonId: row.seasonId || seasonId })
    await get().hydrate()
  },
  remove: async (id) => {
    assertWritableSeason()
    await deleteRow<TransitRoute>(db.routes, id)
    await get().hydrate()
  },
  rebuildFromOrder: async (orderedDropIds, meta) => {
    assertWritableSeason()
    const seasonId = seasonStore.getState().currentSeasonId
    // 只清当前季的路线，往季路线不动
    const existing = await db.routes.where('seasonId').equals(seasonId).toArray()
    await Promise.all(existing.map((row) => deleteRow<TransitRoute>(db.routes, row.id)))
    // 只取当前季的投放点
    const points = await db.dropPoints.where('seasonId').equals(seasonId).toArray()
    const lookup = new Map(points.map((item) => [item.id, item]))
    for (let i = 1; i < orderedDropIds.length; i += 1) {
      const from = lookup.get(orderedDropIds[i - 1])
      const to = lookup.get(orderedDropIds[i])
      if (!from || !to) continue
      const km = distanceKm(from, to)
      await putRow<TransitRoute>(db.routes, {
        id: `rt_${Date.now().toString(36)}_${i}`,
        seasonId,
        fromDropId: from.id,
        toDropId: to.id,
        distanceKm: km,
        durationH: estimateDurationH(km),
        vehicleType: meta.vehicleType,
        departAt: meta.departAt,
        riskNote: meta.riskNote,
        actualNote: '待执行'
      })
    }
    await get().hydrate()
  }
}))
