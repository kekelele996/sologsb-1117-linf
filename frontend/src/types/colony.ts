/** 蜂种 */
export const BEE_SPECIES = ['意蜂', '中蜂'] as const
export type BeeSpecies = (typeof BEE_SPECIES)[number]

/** 蜂群状态 */
export const COLONY_STATUSES = ['待投放', '在园', '转场中', '回场'] as const
export type ColonyStatus = (typeof COLONY_STATUSES)[number]

/** 箱型 */
export const BOX_TYPES = ['标准继箱', '平箱', '交尾箱'] as const
export type BoxType = (typeof BOX_TYPES)[number]

/** BeeColonyBase 蜂群底账：跨季不变的身份（蜂群账） */
export interface BeeColonyBase {
  id: string
  /** 群号（底账身份编号，跨季据此认出是同一群） */
  code: string
  species: BeeSpecies
  boxType: BoxType
}

/** BeeColony 蜂群的当季账：底账快照 + 当季群势 / 上园状态 */
export interface BeeColony extends BeeColonyBase {
  /** 所属授粉季 */
  seasonId: string
  /** 底账 ID，跨季据此认出是同一群 */
  baseId: string
  /** 群势（足框数，当季） */
  strengthFrames: number
  /** 当前所在地块（当季上园状态，开季不带） */
  currentOrchardId: string
  /** 当季状态（待投放/在园/转场中/回场） */
  status: ColonyStatus
  /** 最近检查日期 */
  lastCheckDate: string
  /** 蜂群健康备注 */
  healthNote: string
}
