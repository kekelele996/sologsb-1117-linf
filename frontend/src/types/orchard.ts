/** 作物类型 */
export const CROPS = ['苹果', '梨', '樱桃', '蓝莓', '油菜'] as const
export type Crop = (typeof CROPS)[number]

/** 道路可达性 */
export const ACCESSIBILITIES = ['大车可达', '仅小车', '需步行'] as const
export type Accessibility = (typeof ACCESSIBILITIES)[number]

/** OrchardBase 地块底账：跨季不变的身份与基础档案（地块账） */
export interface OrchardBase {
  id: string
  /** 地块名 */
  name: string
  crop: Crop
  /** 面积（亩） */
  areaMu: number
  longitude: number
  latitude: number
  /** 园主联系方式 */
  ownerContact: string
  accessibility: Accessibility
  /** 历史授粉年份 */
  historyYears: number[]
  note: string
}

/** Orchard 地块的当季账：底账快照 + 当季花期 / 需蜂强度 */
export interface Orchard extends OrchardBase {
  /** 所属授粉季 */
  seasonId: string
  /** 底账 ID，跨季据此认出是同一条地块账 */
  baseId: string
  /** 盛花期起（当季） */
  bloomStart: string
  /** 盛花期止（当季） */
  bloomEnd: string
  /** 需蜂群强度（箱/亩，当季） */
  colonyIntensity: number
}

/** 由面积与需蜂强度算出建议箱数（向上取整，最少 1 箱） */
export function suggestColonyBoxes(orchard: Pick<Orchard, 'areaMu' | 'colonyIntensity'>): number {
  const boxes = Math.ceil((orchard.areaMu || 0) * (orchard.colonyIntensity || 0))
  return boxes > 0 ? boxes : 1
}
