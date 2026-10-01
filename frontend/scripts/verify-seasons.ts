/* eslint-disable no-console */
/**
 * 数据层端到端验证（Node + fake-indexeddb，与浏览器 IndexedDB 行为一致）。
 * 用法：
 *   npx tsx scripts/verify-seasons.ts seed-v2   # 构造旧版 v2 库
 *   npx tsx scripts/verify-seasons.ts migrate   # 验证 v2→v3 升级
 *   npx tsx scripts/verify-seasons.ts rollover  # 验证开新季复制与快照隔离
 *   npx tsx scripts/verify-seasons.ts fresh     # 验证全新库 v3 建账与封存只读
 */
import 'fake-indexeddb/auto'
import Dexie, { type Table } from 'dexie'

const DB_NAME = 'gbbeeroute'
let failures = 0

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason)
  process.exit(2)
})

function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✅ ${label}`)
  } else {
    failures += 1
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 旧版（v2）库：没有季、没有底账，四张表平铺 */
class LegacyDb extends Dexie {
  orchards!: Table<any, string>
  colonies!: Table<any, string>
  dropPoints!: Table<any, string>
  routes!: Table<any, string>
  meta!: Table<{ key: string; value: number | string }, string>

  constructor() {
    super(DB_NAME)
    this.version(1).stores({
      orchards: 'id, name, crop',
      colonies: 'id, code, status',
      dropPoints: 'id, orchardId, code',
      routes: 'id, fromDropId, toDropId',
      meta: 'key'
    })
    this.version(2)
      .stores({
        orchards: 'id, name, crop, bloomStart',
        colonies: 'id, code, status, currentOrchardId',
        dropPoints: 'id, orchardId, code, dropWindow',
        routes: 'id, fromDropId, toDropId, departAt',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        await tx
          .table('dropPoints')
          .toCollection()
          .modify((point: any) => {
            if (!point.capacityBoxes) point.capacityBoxes = 8
          })
      })
  }
}

async function deleteDb(): Promise<void> {
  // Dexie 实例可能仍持有连接；先按名字关闭所有未被引用的 Dexie 连接
  const names = (Dexie as any).dbs?.(DB_NAME)
  void names
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error('deleteDatabase timeout'))
      }
    }, 3000)
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        resolve()
      }
    }
    req.onerror = () => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(req.error)
      }
    }
    req.onblocked = () => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(new Error('delete blocked'))
      }
    }
  })
}

/** 构造旧版 v2 库后关闭（同一进程内再由 v3 重开触发升级） */
async function seedV2(keepOpen = false): Promise<LegacyDb | void> {
  await deleteDb()
  const legacy = new LegacyDb()
  await legacy.open()
  await legacy.orchards.bulkPut([
    { id: 'orc_ap', name: '北岭苹果园', crop: '苹果', areaMu: 120, longitude: 107.4, latitude: 34.6, bloomStart: '2025-04-08', bloomEnd: '2025-04-18', colonyIntensity: 0.1, ownerContact: '周', accessibility: '大车可达', historyYears: [2024], note: '' }
  ])
  await legacy.colonies.bulkPut([
    { id: 'col_001', code: 'Q-01', species: '意蜂', strengthFrames: 8, boxType: '标准继箱', currentOrchardId: 'orc_ap', status: '在园', lastCheckDate: '2025-04-09', healthNote: 'ok' }
  ])
  await legacy.dropPoints.bulkPut([
    { id: 'dp_a01', orchardId: 'orc_ap', longitude: 107.4, latitude: 34.6, code: 'A-01', shade: '', waterDistance: 220, dropWindow: '2025-04-07', withdrawTime: '2025-04-19', owner: '周', colonyCodes: ['Q-01'] }
  ])
  await legacy.routes.bulkPut([
    { id: 'rt_001', fromDropId: 'dp_a01', toDropId: 'dp_a01', distanceKm: 1, durationH: 0.3, vehicleType: '皮卡', departAt: '2025-04-13T06:30', riskNote: '', actualNote: '待执行' }
  ])
  await legacy.meta.put({ key: 'schemaVersion', value: 2 })
  console.log('v2 旧库已构造：1 地块 / 1 蜂群 / 1 投放点 / 1 路线')
  if (keepOpen) return legacy
  await legacy.close()
}

async function loadV3(): Promise<any> {
  // 动态导入当前实现（v3）
  const mod = await import('../src/hooks/usePersistentStore')
  return mod
}

async function verifyMigrate(): Promise<void> {
  // 同进程先铺好 v2 数据并关闭，再让 v3 单例首次查询触发升级
  await seedV2()
  const mod = await loadV3()
  const db = mod.db
  const seasons = await db.seasons.toArray()
  seasons.sort((a: any, b: any) => a.startedAt.localeCompare(b.startedAt))
  const legacySeason = seasons.find((s: any) => s.id === 'season_legacy')
  const allSeasons = await db.seasons.toArray()
  const active = allSeasons.find((s: any) => s.status === 'active')

  check('旧数据归到最早一季（season_legacy，已封存）', Boolean(legacySeason) && legacySeason.status === 'sealed')
  check('升级后自动开出一个活动新季', Boolean(active))
  check('最早季在季列表（按开始时间升序）中排第一', seasons[0]?.id === 'season_legacy')

  const legacyOrc = await db.orchards.where('seasonId').equals('season_legacy').toArray()
  const legacyCol = await db.colonies.where('seasonId').equals('season_legacy').toArray()
  const legacyDp = await db.dropPoints.where('seasonId').equals('season_legacy').toArray()
  const legacyRt = await db.routes.where('seasonId').equals('season_legacy').toArray()
  check('旧地块一条不丢（1 条，baseId 锚定）', legacyOrc.length === 1 && legacyOrc[0].baseId === 'orc_ap')
  check('旧蜂群一条不丢（1 条，baseId 锚定）', legacyCol.length === 1 && legacyCol[0].baseId === 'col_001')
  check('旧投放点随封存季保留（不丢、不进当季）', legacyDp.length === 1 && legacyDp[0].seasonId === 'season_legacy')
  check('旧路线随封存季保留（不丢、不进当季）', legacyRt.length === 1 && legacyRt[0].seasonId === 'season_legacy')

  const oBase = await db.orchardBases.toArray()
  const cBase = await db.colonyBases.toArray()
  check('地块底账建立', oBase.length === 1 && oBase[0].id === 'orc_ap' && !('bloomStart' in oBase[0]))
  check('蜂群底账建立（不含群势/状态等季字段）', cBase.length === 1 && cBase[0].id === 'col_001' && !('strengthFrames' in cBase[0]))

  const activeOrc = await db.orchards.where('seasonId').equals(active.id).toArray()
  const activeCol = await db.colonies.where('seasonId').equals(active.id).toArray()
  const activeDp = await db.dropPoints.where('seasonId').equals(active.id).count()
  const activeRt = await db.routes.where('seasonId').equals(active.id).count()
  check('当季带出地块底账（花期作为新季初值）', activeOrc.length === 1 && activeOrc[0].baseId === 'orc_ap' && activeOrc[0].bloomStart === '2025-04-08' && activeOrc[0].id !== 'orc_ap')
  check('当季带出蜂群、群势预填、上园状态重置为待投放', activeCol.length === 1 && activeCol[0].strengthFrames === 8 && activeCol[0].status === '待投放' && activeCol[0].currentOrchardId === '' && activeCol[0].lastCheckDate === '')
  check('当季不带投放点（不混进当季冲突/箱位核算）', activeDp === 0)
  check('当季不带路线', activeRt === 0)

  const meta = await db.meta.get(mod.META_CURRENT_SEASON)
  check('当前季指向活动新季', meta?.value === active.id)

  // 当季修改花期不得改写封存季那份
  activeOrc[0].bloomStart = '2099-09-09'
  activeOrc[0].bloomEnd = '2099-09-19'
  await db.orchards.put(activeOrc[0])
  const legacyAfter = await db.orchards.get(legacyOrc[0].id)
  check('当季改花期，往季那份不变', legacyAfter.bloomStart === '2025-04-08' && legacyAfter.bloomEnd === '2025-04-18')
  const baseAfter = await db.orchardBases.get('orc_ap')
  check('底账本身不含花期字段', !('bloomStart' in baseAfter))

  // 封存季只读守卫：把当前季切到封存季再写
  await db.meta.put({ key: mod.META_CURRENT_SEASON, value: 'season_legacy' })
  let blocked = false
  try {
    await mod.requireActiveSeason()
  } catch {
    blocked = true
  }
  check('封存往季写操作被守卫拒绝', blocked)
}

async function verifyRollover(skipMigrate = false): Promise<void> {
  // 单跑 rollover 时先同进程完成 v2→v3 升级；all 模式下复用已升级好的库
  if (skipMigrate) await verifyMigrate()
  const mod = await loadV3()
  const db = mod.db

  // 初始：当前应是活动季；切回活动季做一些当季数据
  let active = (await db.seasons.toArray()).find((s: any) => s.status === 'active')
  await db.meta.put({ key: mod.META_CURRENT_SEASON, value: active.id })

  // 用 store 开新季
  const { seasonStore } = await import('../src/stores/seasonStore')
  await seasonStore.getState().hydrate()
  await seasonStore.getState().openNextSeason('2027年授粉季')

  const seasons = await db.seasons.orderBy('startedAt').toArray()
  check('开新季后共 3 季（旧封存 + 首活动季已封存 + 新活动季）', seasons.length === 3)
  const newest = seasons[seasons.length - 1]
  check('新季为活动季且被设为当前季', newest.status === 'active' && newest.name === '2027年授粉季' && (await db.meta.get(mod.META_CURRENT_SEASON))?.value === newest.id)
  check('原当季已被封存', seasons[seasons.length - 2].status === 'sealed')

  const newOrc = await db.orchards.where('seasonId').equals(newest.id).toArray()
  const newCol = await db.colonies.where('seasonId').equals(newest.id).toArray()
  check('新季地块 baseId 与往季同一底账（跨季认得出）', newOrc.length === 1 && newOrc[0].baseId === 'orc_ap')
  check('新季蜂群 baseId 与往季同一群', newCol.length === 1 && newCol[0].baseId === 'col_001')
  check('新季投放点为 0（不带）', (await db.dropPoints.where('seasonId').equals(newest.id).count()) === 0)
  check('新季路线为 0（不带）', (await db.routes.where('seasonId').equals(newest.id).count()) === 0)
  check('新季蜂群上园状态重置', newCol[0].status === '待投放' && newCol[0].currentOrchardId === '')

  // 新季改群势：往季两份都不能变
  newCol[0].strengthFrames = 2
  await db.colonies.put(newCol[0])
  const firstSeasonCol = await db.colonies.where('baseId').equals('col_001').toArray()
  const legacy = firstSeasonCol.filter((c: any) => c.seasonId === 'season_legacy')
  const mid = firstSeasonCol.filter((c: any) => c.seasonId !== 'season_legacy' && c.seasonId !== newest.id)
  check('改新季群势后，往季群势不变', legacy[0]?.strengthFrames === 8 && mid[0]?.strengthFrames === 8)
  check('底账不存群势，改群势不影响底账身份', !('strengthFrames' in (await db.colonyBases.get('col_001'))))

  // 地块与蜂群各自维护：底账分两张表，互不引用
  const orcBaseCount = await db.orchardBases.count()
  const colBaseCount = await db.colonyBases.count()
  check('地块/蜂群底账各自独立维护', orcBaseCount === 1 && colBaseCount === 1)

  // 封存动作
  await seasonStore.getState().sealCurrentSeason()
  const nowSealed = await db.seasons.get(newest.id)
  check('封存当季后状态变 sealed 且记录封存时间', nowSealed.status === 'sealed' && Boolean(nowSealed.sealedAt))
  let blocked = false
  try {
    await mod.requireActiveSeason()
  } catch {
    blocked = true
  }
  check('全部封存后无活动季，写操作被拒绝', blocked)

  await db.close()
}

async function verifyFresh(): Promise<void> {
  // 释放前面流程持有的 Dexie 连接，否则 deleteDatabase 会被阻塞
  try {
    const mod0 = await loadV3()
    mod0.db.close()
    // 等待底层连接完全释放
    await new Promise((resolve) => setTimeout(resolve, 100))
  } catch {
    // 忽略
  }
  await deleteDb()
  // 单例已 close，重新 open 一个全新空库让 seedDemoData 建账
  const mod = await loadV3()
  await mod.db.open()
  await mod.seedDemoData()
  const db = mod.db
  const seasons = await db.seasons.toArray()
  check('全新库：建立 1 个活动季', seasons.length === 1 && seasons[0].status === 'active')
  const sid = seasons[0].id
  check('全新库：地块挂当季且带 baseId', (await db.orchards.where('seasonId').equals(sid).count()) === 3)
  check('全新库：蜂群挂当季且带 baseId', (await db.colonies.where('seasonId').equals(sid).count()) === 3)
  check('全新库：投放点挂当季', (await db.dropPoints.where('seasonId').equals(sid).count()) === 3)
  check('全新库：路线挂当季', (await db.routes.where('seasonId').equals(sid).count()) === 1)
  check('全新库：地块底账 3 条', (await db.orchardBases.count()) === 3)
  check('全新库：蜂群底账 3 条', (await db.colonyBases.count()) === 3)

  // store 写入在活动季成功，封存后拒绝
  const { orchardStore } = await import('../src/stores/orchardStore')
  await orchardStore.getState().hydrate(sid)
  await orchardStore.getState().save({
    id: 'orc_new',
    name: '新地块',
    crop: '梨',
    areaMu: 10,
    longitude: 1,
    latitude: 1,
    bloomStart: '2026-04-01',
    bloomEnd: '2026-04-10',
    colonyIntensity: 0.2,
    ownerContact: '',
    accessibility: '需步行',
    historyYears: [],
    note: ''
  })
  check('活动季新增地块：季行与底账同号', Boolean(await db.orchards.get('orc_new')) && Boolean(await db.orchardBases.get('orc_new')))

  await db.close()
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'all'
  console.log(`\n=== verify: ${mode} ===`)
  if (mode === 'seed-v2') {
    await seedV2()
  } else if (mode === 'migrate') {
    await verifyMigrate()
  } else if (mode === 'rollover') {
    await verifyRollover(true)
  } else if (mode === 'fresh') {
    await verifyFresh()
  } else if (mode === 'all') {
    await verifyMigrate()
    await verifyRollover(false)
    await verifyFresh()
  } else {
    throw new Error(`unknown mode: ${mode}`)
  }
  if (failures > 0) {
    console.error(`\n💥 ${failures} 条断言失败`)
    process.exit(1)
  }
  console.log('\n🎉 全部断言通过')
}

void main()
