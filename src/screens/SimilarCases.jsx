// 11-25 유사 과거 사례 (목업). 판례를 찾듯이, 이번 상황 조건과 많이 겹치는 과거 확정 사례 3건을 보여 준다.
//  - 이번 상황 조건: 지금 계획 조건 · 받은 메일 · 리스크에서 실제로 뽑는다.
//  - 안전비용(정량 지표): (후보 체선료 − 최저안 체선료) ÷ 최저안 체선료. 이번 후보 값은 실제 엔진 결과로 계산한다.
//  - 과거 사례(선택한 안, 그때 안전비용 · 리스크 · 작업자 근거)는 가상 데이터다. 나중에 확정 기록(근거 · 리스크 · A/B/C 체선료)을 쌓아 같은 모양으로 바꾼다.
import { useState } from 'react'
import { Dialog } from '@blueprintjs/core'
import { Panel } from '../ui/kit.jsx'
import './similar.css'

// 가상 사례. tags = 그때 상황 조건, pick = 선택한 안, safety = 선택한 안의 안전비용(%), risks = 그때 남은 리스크, reason = 작업자 근거
const CASES = [
  { date: '2026-11-02', title: '강풍 예보, 5부두 설비 점검', tags: ['강풍 예보', '설비 점검'], pick: 'B', pickLabel: '안전 우선', safety: 1.9, risks: '높음 1 (작업 간격)', reason: '강풍 뒤 점검이 겹쳐 하루 여유를 둠' },
  { date: '2026-10-03', title: '설비 점검, 6척 집중', tags: ['설비 점검', '선박 집중'], pick: 'B', pickLabel: '안전 우선', safety: 3.1, risks: '높음 2 (작업 간격 · 정박시간)', reason: '5부두 점검이 늘어날 수 있어 앞뒤 간격을 넓힘' },
  { date: '2026-09-18', title: '강풍 예보, 5척 집중', tags: ['강풍 예보', '선박 집중'], pick: 'A', pickLabel: '체선료 최소', safety: 0, risks: '높음 1 (작업 간격)', reason: '출하 납기에 이틀 여유가 있었음' },
  { date: '2026-08-27', title: '태풍 접근, 긴급 출하 1건', tags: ['태풍 접근', '긴급 출하'], pick: 'B', pickLabel: '출하 납기 우선', safety: 2.3, risks: '높음 2 (기상 · 지연 시 조건 위반)', reason: '항공유 재고가 2일분 미만이었음' },
  { date: '2026-07-12', title: 'ETA 지연 3척, 원유 탱크 상한 근접', tags: ['ETA 지연', '탱크 경계'], pick: 'C', pickLabel: '안전 우선', safety: 6.2, risks: '높음 1 · 중간 2 (탱크 상한)', reason: '원유 탱크가 상한 4%p 안이라 입고 순서를 늦춤' },
  { date: '2026-06-21', title: '강풍 예보, 긴급 출하 1건', tags: ['강풍 예보', '긴급 출하'], pick: 'C', pickLabel: '출하 납기 우선', safety: 4.8, risks: '높음 2 (지연 시 조건 위반 · 탱크 하한)', reason: '생산 중단을 막으려면 나프타 하역이 먼저였음' },
  { date: '2026-05-30', title: '탱크 경계, 7척 집중', tags: ['탱크 경계', '선박 집중'], pick: 'A', pickLabel: '체선료 최소', safety: 0, risks: '중간 1 (탱크 하한)', reason: '안전비용이 7%로 커서 최소안을 고르고 생산계획팀과 협의' },
  { date: '2026-04-14', title: '긴급 출하, ETA 지연 2척', tags: ['긴급 출하', 'ETA 지연'], pick: 'A', pickLabel: '체선료 최소', safety: 0, risks: '높음 1 (고정 선박 밀림)', reason: '고정 1척만 지키면 나머지 영향이 작았음' },
]
const TOP_K = 3

/** 이번 상황 조건: 계획 조건(부두 사용 불가 · 고정 · 조절값) + 반영 여부를 정하지 않은 메일 + 첫날 입항 척수 + 탱크 리스크 */
function situationTags(scen, all, risks, pendingIncs) {
  const kinds = new Set([...pendingIncs.map((i) => i.kind), ...(scen.incidents ?? []).filter((i) => scen.blocks.some((b) => b.incId === i.id) || scen.fixes.some((f) => f.incId === i.id)).map((i) => i.kind)])
  const firstDay = scen.vessels.filter((v) => v.eta >= 0 && v.eta < 24 * 60).length
  const tankRisk = all.some((s) => risks[s.id]?.data?.risks?.some((r) => r.kind === 'TANK' && r.severity !== 'LOW'))
  const tags = []
  if (kinds.has('강풍 예보') || scen.blocks.some((b) => b.kind === 'WEATHER')) tags.push('강풍 예보')
  if (firstDay >= 20) tags.push('선박 집중')
  if (kinds.has('우선 접안') || scen.fixes.length) tags.push('긴급 출하')
  if (kinds.has('설비 고장') || scen.blocks.some((b) => b.kind === 'EQUIPMENT')) tags.push('설비 점검')
  if (kinds.has('ETA 지연')) tags.push('ETA 지연')
  if (tankRisk || kinds.has('탱크 운영') || scen.params.tank) tags.push('탱크 경계')
  return { tags, firstDay }
}

export default function SimilarCases({ scen, all, risks, pendingIncs }) {
  const [showAll, setShowAll] = useState(false)
  const { tags } = situationTags(scen, all, risks, pendingIncs)
  const now = new Set(tags)
  const ranked = CASES.map((c) => ({ ...c, hit: c.tags.filter((t) => now.has(t)).length }))
    .sort((a, b) => b.hit - a.hit || b.date.localeCompare(a.date))
  const low = Math.min(...all.map((s) => s.total))
  const safety = (s) => (low > 0 ? ((s.total - low) / low) * 100 : 0)
  const pct = (p) => (p === 0 ? '0%' : `+${p.toFixed(1)}%`)

  const card = (c) => (
    <li key={c.date} className="sc-case">
      <b className="sc-title"><span className="num">{c.date}</span> · {c.title}</b>
      <div className="sc-tags">
        {c.tags.map((t) => <span key={t} className={`sc-tag ${now.has(t) ? 'hit' : ''}`}>{t}</span>)}
        <span className="sc-hit">{tags.length}개 중 {c.hit}개 일치</span>
      </div>
      <p>선택: <b>{c.pickLabel}</b> (후보 {c.pick}, 안전비용 {pct(c.safety)})</p>
      <p>그때 리스크: {c.risks}</p>
      <p>사유: {c.reason}</p>
    </li>
  )

  return (
    <Panel code="PRECEDENT" title="유사 과거 사례" pad className="sc">
      <p className="sc-sub">상황 조건이 많이 겹치는 순입니다. (가상 데이터)</p>
      <div className="sc-now">
        <span className="sc-label">이번 상황 조건</span>
        <div className="sc-tags">{tags.length ? tags.map((t) => <span key={t} className="sc-tag hit">{t}</span>) : <span className="sc-hit">특이 조건 없음</span>}</div>
        <span className="sc-label">이번 후보 안전비용</span>
        <div className="sc-safety">{all.map((s) => <span key={s.id}><b>{s.id}</b> <span className="num">{pct(safety(s))}</span></span>)}</div>
      </div>
      <ul className="sc-list">{ranked.slice(0, TOP_K).map(card)}</ul>
      <button type="button" className="sc-more" onClick={() => setShowAll(true)}>전체 사례 보기</button>
      <Dialog isOpen={showAll} onClose={() => setShowAll(false)} title={`유사 과거 사례 · 전체 ${CASES.length}건 (가상 데이터)`} className="sc-dialog">
        <ul className="sc-list sc-all">{ranked.map(card)}</ul>
      </Dialog>
    </Panel>
  )
}
