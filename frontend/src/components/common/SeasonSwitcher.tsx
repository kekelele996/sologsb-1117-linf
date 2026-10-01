import { useState } from 'react'
import { Button, Input, Modal, Select, Space, Tag, Typography, message } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { seasonStore } from '@/stores/seasonStore'
import { rehydrateSeasonStores, useCurrentSeason } from '@/hooks/useSeason'

function defaultNextSeasonName(): string {
  return `${new Date().getFullYear() + 1}年授粉季`
}

/** 顶部授粉季切换器：切季查看 / 开新季 / 封存当季 */
export default function SeasonSwitcher(): JSX.Element {
  const rows = usePersistentStore(seasonStore, (state) => state.rows)
  const currentSeason = useCurrentSeason()
  const [openModal, setOpenModal] = useState(false)
  const [name, setName] = useState(defaultNextSeasonName())
  const [busy, setBusy] = useState(false)

  async function handleChange(seasonId: string): Promise<void> {
    await seasonStore.getState().switchSeason(seasonId)
    await rehydrateSeasonStores(seasonId)
    const target = seasonStore.getState().currentSeason
    message.info(target?.status === 'sealed' ? `已切换到封存季「${target?.name}」（只读）` : `已切换到当季「${target?.name}」`)
  }

  async function handleOpenNext(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      message.warning('请填写新季名称')
      return
    }
    setBusy(true)
    try {
      await seasonStore.getState().openNextSeason(trimmed)
      const nextId = seasonStore.getState().currentSeasonId
      await rehydrateSeasonStores(nextId)
      message.success(`已开新季「${trimmed}」：地块与蜂群底账已带入，投放点与路线请重新布置`)
      setOpenModal(false)
    } finally {
      setBusy(false)
    }
  }

  function handleSeal(): void {
    const current = seasonStore.getState().currentSeason
    if (!current || current.status !== 'active') return
    Modal.confirm({
      title: `封存「${current.name}」？`,
      content: '封存后该季的地块花期、蜂群群势、投放点与路线全部冻结，只能查看与导出，不能再改动。',
      okText: '确认封存',
      cancelText: '再想想',
      onOk: async () => {
        await seasonStore.getState().sealCurrentSeason()
        await rehydrateSeasonStores(seasonStore.getState().currentSeasonId)
        message.success('该授粉季已封存')
      }
    })
  }

  const locked = currentSeason?.status === 'sealed'

  return (
    <Space size={8}>
      <Select
        value={currentSeason?.id}
        onChange={(value: string) => void handleChange(value)}
        style={{ minWidth: 220 }}
        options={[...rows]
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .map((item) => ({
            value: item.id,
            label: (
              <Space size={4}>
                <span>{item.name}</span>
                {item.status === 'active' ? <Tag color="green" style={{ marginInlineEnd: 0 }}>当季</Tag> : <Tag style={{ marginInlineEnd: 0 }}>已封存</Tag>}
              </Space>
            )
          }))}
      />
      {locked ? (
        <Button icon={<LockOutlined />} onClick={() => void handleChange(rows.find((item) => item.status === 'active')?.id ?? currentSeason?.id ?? '')} disabled={!rows.some((item) => item.status === 'active')}>
          回到当季
        </Button>
      ) : (
        <>
          <Button onClick={() => { setName(defaultNextSeasonName()); setOpenModal(true) }}>开新季</Button>
          <Button danger onClick={handleSeal}>封存当季</Button>
        </>
      )}

      <Modal
        title="开新授粉季"
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={() => void handleOpenNext()}
        confirmLoading={busy}
        okText="开季并带入底账"
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          开季后当前季自动封存。新季只带入<b>地块底账（花期预填）</b>与<b>蜂群底账（群势预填，上园状态重置为待投放）</b>；
          投放点、转场路线不带，冲突与箱位核算只算新季。
        </Typography.Paragraph>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="如 2027年授粉季" onPressEnter={() => void handleOpenNext()} />
      </Modal>
    </Space>
  )
}

/** 封存往季只读提示条 */
export function SeasonLockedBanner(): JSX.Element | null {
  const currentSeason = useCurrentSeason()
  if (!currentSeason || currentSeason.status !== 'sealed') return null
  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text type="warning">
        <LockOutlined /> 当前查看的是已封存的「{currentSeason.name}」，只能查看与导出，不能修改；开新季或切换到当季可继续作业。
      </Typography.Text>
    </div>
  )
}
