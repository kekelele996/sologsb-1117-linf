/** 季状态：进行中（可读写）/ 已封存（仅可查看与导出） */
export type SeasonStatus = 'active' | 'archived'

/** Season 授粉季：一季一份账，地块 / 蜂群 / 投放点 / 转场路线全部按季隔离 */
export interface Season {
  id: string
  /** 季名，如「2027 春」 */
  name: string
  /** 年份（用于排序与默认命名） */
  year: number
  status: SeasonStatus
  /** 开季时间 ISO */
  createdAt: string
  /** 封存时间 ISO */
  archivedAt?: string
  /** 备注（如开季来源、升级说明） */
  note: string
}
