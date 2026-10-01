import { Tag } from 'antd'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { seasonStore } from '@/stores/seasonStore'

/** 底账连作标签：同一条底账（masterId）跨了几个授粉季；仅在跨季时显示 */
export default function MasterSeasonTag({
  masterId,
  kind
}: {
  masterId: string
  kind: 'orchard' | 'colony'
}): JSX.Element | null {
  const count = usePersistentStore(seasonStore, (state) =>
    kind === 'orchard' ? state.orchardCounts[masterId] ?? 0 : state.colonyCounts[masterId] ?? 0
  )
  if (count <= 1) return null
  return (
    <Tag color="geekblue" title="同一底账跨季保留：各季内容独立，当季修改不影响往季">
      {kind === 'orchard' ? `连作 ${count} 季` : `同群跨 ${count} 季`}
    </Tag>
  )
}
