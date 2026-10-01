import { seasonStore } from './seasonStore'
import { orchardStore } from './orchardStore'
import { colonyStore } from './colonyStore'
import { droppointStore } from './droppointStore'
import { routeStore } from './routeStore'

/** 水合全部 store：先季账（确定当前季），再按季拉取四类台账 */
export async function hydrateAll(): Promise<void> {
  await seasonStore.getState().hydrate()
  await Promise.all([
    orchardStore.getState().hydrate(),
    colonyStore.getState().hydrate(),
    droppointStore.getState().hydrate(),
    routeStore.getState().hydrate()
  ])
}
