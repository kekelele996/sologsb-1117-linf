import { usePersistentStore } from '@/hooks/usePersistentStore'
import { seasonStore } from '@/stores/seasonStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import type { Season } from '@/types'

/** 当前正在查看的授粉季 */
export function useCurrentSeason(): Season | null {
  return usePersistentStore(seasonStore, (state) => state.currentSeason)
}

/** 当前查看的是否为已封存往季（封存后只读：只能看和导出） */
export function useSeasonLocked(): boolean {
  return usePersistentStore(seasonStore, (state) => state.currentSeason?.status === 'sealed')
}

/** 按指定授粉季重新水合四张季内表 */
export async function rehydrateSeasonStores(seasonId: string): Promise<void> {
  await Promise.all([
    orchardStore.getState().hydrate(seasonId),
    colonyStore.getState().hydrate(seasonId),
    droppointStore.getState().hydrate(seasonId),
    routeStore.getState().hydrate(seasonId)
  ])
}
