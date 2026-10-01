import { create } from 'zustand'
import type { BeeColony, ColonyStatus, Orchard, Season } from '@/types'
import { db, loadAll, usePersistentStore } from '@/hooks/usePersistentStore'
import { uid } from '@/utils/id'
import { hydrateAll } from './hydrate'

const CURRENT_SEASON_KEY = 'gbbeeroute:currentSeasonId'

function readStoredSeasonId(): string {
  try {
    return localStorage.getItem(CURRENT_SEASON_KEY) ?? ''
  } catch {
    return ''
  }
}

function storeSeasonId(id: string): void {
  try {
    localStorage.setItem(CURRENT_SEASON_KEY, id)
  } catch {
    /* 隐私模式等场景下忽略持久化失败 */
  }
}

export interface CreateSeasonInput {
  name: string
  year: number
  /** 开季后是否同时封存来源季（往季仅可查看与导出） */
  archiveSource: boolean
}

export interface SeasonState {
  rows: Season[]
  currentSeasonId: string
  loaded: boolean
  /** 地块底账标识 → 跨季份数（masterId 相同即同一条底账） */
  orchardCounts: Record<string, number>
  /** 蜂群底账标识 → 跨季份数 */
  colonyCounts: Record<string, number>
  hydrate: () => Promise<void>
  switchSeason: (id: string) => void
  createSeason: (input: CreateSeasonInput) => Promise<{ carriedOrchards: number; carriedColonies: number }>
  archiveSeason: (id: string) => Promise<void>
}

export const seasonStore = create<SeasonState>((set, get) => ({
  rows: [],
  currentSeasonId: '',
  loaded: false,
  orchardCounts: {},
  colonyCounts: {},

  hydrate: async () => {
    const rows = await loadAll<Season>(db.seasons)
    rows.sort((a, b) => a.year - b.year || a.createdAt.localeCompare(b.createdAt))

    // 当前季以内存状态为准（localStorage 仅作跨会话持久化）；
    // 内存与本地都失效时回退到进行中的季。
    let currentSeasonId = readStoredSeasonId()
    if (!rows.some((season) => season.id === currentSeasonId)) {
      currentSeasonId = get().currentSeasonId
      if (!rows.some((season) => season.id === currentSeasonId)) {
        currentSeasonId = rows.find((season) => season.status === 'active')?.id ?? rows[0]?.id ?? ''
      }
      storeSeasonId(currentSeasonId)
    }

    // 跨季底账份数（不按季过滤，用于「同一条底账跨几季」提示）
    const [allOrchards, allColonies] = await Promise.all([
      loadAll<Orchard>(db.orchards),
      loadAll<BeeColony>(db.colonies)
    ])
    const orchardCounts: Record<string, number> = {}
    const colonyCounts: Record<string, number> = {}
    allOrchards.forEach((item) => {
      const key = item.masterId || item.id
      orchardCounts[key] = (orchardCounts[key] ?? 0) + 1
    })
    allColonies.forEach((item) => {
      const key = item.masterId || item.id
      colonyCounts[key] = (colonyCounts[key] ?? 0) + 1
    })

    set({ rows, currentSeasonId, loaded: true, orchardCounts, colonyCounts })
  },

  switchSeason: (id) => {
    storeSeasonId(id)
    set({ currentSeasonId: id })
    void hydrateAll()
  },

  createSeason: async (input) => {
    const state = get()
    const source =
      state.rows.find((season) => season.id === state.currentSeasonId) ??
      state.rows.find((season) => season.status === 'active') ??
      state.rows[0]
    if (!source) throw new Error('没有可带入底账的来源季')

    const newId = uid('season')
    const now = new Date().toISOString()
    await db.seasons.put({
      id: newId,
      name: input.name.trim() || `${input.year} 春`,
      year: input.year,
      status: 'active',
      createdAt: now,
      note: `由「${source.name}」开季带入地块与蜂群底账`
    })

    // 地块底账：整份复制、换发新 id、保留 masterId（跨季认得出是同一条底账）；
    // 花期等字段各季独立，当季修改不影响往季。
    const oldOrchards = await db.orchards.where('seasonId').equals(source.id).toArray()
    const newOrchards = oldOrchards.map((item) => ({
      ...item,
      id: uid('orc'),
      seasonId: newId,
      masterId: item.masterId || item.id
    }))
    await db.orchards.bulkPut(newOrchards)

    // 蜂群底账：整份复制、换发新 id、保留 masterId；上园状态清空
    //（状态回到待投放、当前所在地块清空），群势等字段各季独立。
    const oldColonies = await db.colonies.where('seasonId').equals(source.id).toArray()
    const newColonies = oldColonies.map((item) => ({
      ...item,
      id: uid('col'),
      seasonId: newId,
      masterId: item.masterId || item.id,
      status: '待投放' as ColonyStatus,
      currentOrchardId: ''
    }))
    await db.colonies.bulkPut(newColonies)

    // 投放点与转场路线属于季内作业数据，开季不带入（等价于手工清空）。

    if (input.archiveSource && source.status === 'active') {
      await db.seasons.update(source.id, { status: 'archived', archivedAt: now })
    }

    storeSeasonId(newId)
    set({ currentSeasonId: newId })
    await get().hydrate()
    await hydrateAll()
    return { carriedOrchards: newOrchards.length, carriedColonies: newColonies.length }
  },

  archiveSeason: async (id) => {
    const now = new Date().toISOString()
    await db.seasons.update(id, { status: 'archived', archivedAt: now })
    const state = get()
    if (state.currentSeasonId === id) {
      // 有其他进行中的季则切过去；否则停留在本封存季（只读，用户可开新季）
      const next = state.rows.find((season) => season.id !== id && season.status === 'active')
      storeSeasonId(next?.id ?? id)
      set({ currentSeasonId: next?.id ?? id })
    }
    await get().hydrate()
    await hydrateAll()
  }
}))

/** 当前授粉季是否已封存（封存季只读） */
export function isCurrentSeasonArchived(): boolean {
  const { rows, currentSeasonId } = seasonStore.getState()
  return rows.find((season) => season.id === currentSeasonId)?.status === 'archived'
}

/** 写入守卫：已封存的授粉季不允许任何增删改（UI 层也会同步禁用） */
export function assertWritableSeason(): void {
  if (isCurrentSeasonArchived()) {
    throw new Error('当前授粉季已封存，仅可查看与导出；请切换到进行中的季或开新季')
  }
}

/** 当前授粉季是否只读（封存后仅可查看与导出） */
export function useSeasonReadonly(): boolean {
  return usePersistentStore(seasonStore, (state) => {
    const current = state.rows.find((item) => item.id === state.currentSeasonId)
    return current?.status === 'archived'
  })
}
