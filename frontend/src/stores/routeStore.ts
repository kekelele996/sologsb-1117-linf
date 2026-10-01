import { create } from 'zustand'
import type { DropPoint, TransitRoute } from '@/types'
import { db, deleteRow, loadAll, putRow, requireActiveSeason } from '@/hooks/usePersistentStore'
import { distanceKm, estimateDurationH } from '@/utils/geo'

/** 路线提交内容（季归属由 store 补齐） */
export type TransitRouteDraft = Omit<TransitRoute, 'seasonId'>

export interface RouteState {
  rows: TransitRoute[]
  seasonId: string
  loaded: boolean
  hydrate: (seasonId: string) => Promise<void>
  save: (draft: TransitRouteDraft) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 按选点顺序重排并重算里程 / 耗时，生成连续转场段（只作用于当季） */
  rebuildFromOrder: (
    orderedDropIds: string[],
    meta: { vehicleType: TransitRoute['vehicleType']; departAt: string; riskNote: string }
  ) => Promise<void>
}

export const routeStore = create<RouteState>((set, get) => ({
  rows: [],
  seasonId: '',
  loaded: false,
  hydrate: async (seasonId) => {
    const rows = seasonId
      ? ((await db.routes.where('seasonId').equals(seasonId).toArray()) as TransitRoute[])
      : await loadAll<TransitRoute>(db.routes)
    rows.sort((a, b) => a.departAt.localeCompare(b.departAt))
    set({ rows, seasonId, loaded: true })
  },
  save: async (draft) => {
    const seasonId = await requireActiveSeason()
    await putRow<TransitRoute>(db.routes, { ...draft, seasonId })
    await get().hydrate(seasonId)
  },
  remove: async (id) => {
    const seasonId = await requireActiveSeason()
    await deleteRow<TransitRoute>(db.routes, id)
    await get().hydrate(seasonId)
  },
  rebuildFromOrder: async (orderedDropIds, meta) => {
    const seasonId = await requireActiveSeason()
    // 仅清空当季路线；往季路线不受影响
    const existing = (await db.routes.where('seasonId').equals(seasonId).toArray()) as TransitRoute[]
    await Promise.all(existing.map((row) => deleteRow<TransitRoute>(db.routes, row.id)))
    const points = (await db.dropPoints.where('seasonId').equals(seasonId).toArray()) as Array<
      Pick<DropPoint, 'id' | 'longitude' | 'latitude'>
    >
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
    await get().hydrate(seasonId)
  }
}))
