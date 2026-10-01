import { useMemo, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Switch, Tag, Typography, message } from 'antd'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { seasonStore } from '@/stores/seasonStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'

/** 季账切换器：切换授粉季、开新季（带入地块与蜂群底账）、封存往季 */
export default function SeasonSwitcher(): JSX.Element {
  const seasons = usePersistentStore(seasonStore, (state) => state.rows)
  const currentSeasonId = usePersistentStore(seasonStore, (state) => state.currentSeasonId)
  const switchSeason = usePersistentStore(seasonStore, (state) => state.switchSeason)
  const createSeason = usePersistentStore(seasonStore, (state) => state.createSeason)
  const archiveSeason = usePersistentStore(seasonStore, (state) => state.archiveSeason)
  const orchardCount = usePersistentStore(orchardStore, (state) => state.rows.length)
  const colonyCount = usePersistentStore(colonyStore, (state) => state.rows.length)

  const [createOpen, setCreateOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [name, setName] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [archiveSource, setArchiveSource] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const current = useMemo(
    () => seasons.find((item) => item.id === currentSeasonId),
    [seasons, currentSeasonId]
  )
  const readonly = current?.status === 'archived'

  function openCreate(): void {
    setName('')
    setYear(new Date().getFullYear())
    setArchiveSource(true)
    setCreateOpen(true)
  }

  async function submitCreate(): Promise<void> {
    setSubmitting(true)
    try {
      const result = await createSeason({
        name: name.trim() || `${year} 春`,
        year,
        archiveSource
      })
      message.success(
        `新季已开：带入 ${result.carriedOrchards} 块地块底账、${result.carriedColonies} 群蜂底账；投放点与路线未带入，蜂群状态已重置为待投放`
      )
      setCreateOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '开季失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitArchive(): Promise<void> {
    if (!current) return
    setSubmitting(true)
    try {
      await archiveSeason(current.id)
      message.success(`「${current.name}」已封存，往季数据仅可查看与导出`)
      setArchiving(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '封存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Space size={8} wrap>
      <Select
        style={{ width: 200 }}
        value={currentSeasonId || undefined}
        onChange={switchSeason}
        placeholder="选择授粉季"
        options={seasons.map((item) => ({
          value: item.id,
          label: `${item.name}${item.status === 'archived' ? '（已封存）' : ''}`
        }))}
      />
      {current ? (
        <Tag color={readonly ? 'default' : 'green'}>{readonly ? '已封存 · 只读' : '进行中'}</Tag>
      ) : null}
      <Button type="primary" size="small" onClick={openCreate}>
        开新季
      </Button>
      {current && !readonly ? (
        <Button size="small" onClick={() => setArchiving(true)}>
          封存本季
        </Button>
      ) : null}

      <Modal
        title="开新季（一季一份账）"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        confirmLoading={submitting}
        okText="开季"
        cancelText="取消"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="开季只带入底账：地块与蜂群整份复制到新季（同一条底账跨季相认，当季改花期 / 群势互不影响）；投放点与转场路线不带入，蜂群状态重置为待投放、上园状态清空。"
        />
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Space>
            <Typography.Text>季名</Typography.Text>
            <Input
              style={{ width: 220 }}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`${year} 春`}
            />
          </Space>
          <Space>
            <Typography.Text>年份</Typography.Text>
            <InputNumber min={2000} max={2100} value={year} onChange={(value) => setYear(value ?? new Date().getFullYear())} />
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            将从「{current?.name ?? '—'}」带入：地块 {orchardCount} 块、蜂群 {colonyCount} 群。
          </Typography.Text>
          <Space>
            <Switch checked={archiveSource} onChange={setArchiveSource} />
            <Typography.Text>开季后同时封存「{current?.name ?? '来源季'}」（往季仅可查看与导出）</Typography.Text>
          </Space>
        </Space>
      </Modal>

      <Modal
        title="封存本季"
        open={archiving}
        onCancel={() => setArchiving(false)}
        onOk={() => void submitArchive()}
        confirmLoading={submitting}
        okText="确认封存"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <Typography.Paragraph>
          封存后「{current?.name}」的地块、蜂群、投放点与路线将<strong>只能查看与导出，不能修改</strong>。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          封存不会删除任何数据；随时可切换回该季查看，或在导出页备份全部季账。
        </Typography.Paragraph>
      </Modal>
    </Space>
  )
}
