/** 授粉季状态：进行中 / 已封存（封存后仅可查看与导出） */
export const SEASON_STATUSES = ['active', 'sealed'] as const
export type SeasonStatus = (typeof SEASON_STATUSES)[number]

/** Season 授粉季（一季一份账） */
export interface Season {
  id: string
  /** 季名，如 2026年授粉季 */
  name: string
  status: SeasonStatus
  /** 开季时间（ISO） */
  startedAt: string
  /** 封存时间（ISO），进行中为空串 */
  sealedAt: string
  note: string
}
