// 선박 카드 (11-24 실데이터): 데이터 팀 묶음에 있는 값과 팀 엔진(CP-SAT)이 낸 시각, 체선료만 보인다.
// 화면에서 체선료를 다시 계산하지 않는다. 「계획 일정」 탭은 계획 시점(데이터셋 기준 시각)에 세운 예정 시각을 순서대로 풀어 쓴 것이다(11-25 '산출 근거'에서 바꿈).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Drawer, Icon, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { useDarkClass } from '../state/theme.js'
import { stateAt } from '../lib/plan.js'
import { vesselIdOf } from '../lib/dataset.js'
import { fmt, fmtDur, fmtFull, money } from '../lib/time.js'
import { addNote, historyOf, notesOf, removeNote, role } from '../lib/workspace.js'
import { Panel, St } from '../ui/kit.jsx'
import './drawer.css'

const PHASE = {
  coming: { label: '입항 전', tone: 'live' },
  waiting: { label: '정박지 대기', tone: 'warn' },
  berthed: { label: '접안 중', tone: 'ok' },
  left: { label: '이안', tone: 'idle' },
}

function Details({ rows }) {
  return (
    <table className="vessel-drawer-kv">
      <tbody>{rows.filter(Boolean).map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody>
    </table>
  )
}

export default function VesselDrawer() {
  const { drawer, drawerSim: sim, result, all, scen, closeDrawer, isScheduler, tour, scenarioId } = useApp()
  const dark = useDarkClass()
  const [view, setView] = useState(drawer?.mode ?? 'card')
  const scrollRef = useRef(null)
  useEffect(() => { setView(drawer?.mode ?? 'card') }, [drawer?.simId, drawer?.vid, drawer?.mode])
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [view])

  const me = useMemo(() => {
    if (!drawer || !sim || !scen) return null
    const p = sim.placements.find((x) => x.vid === drawer.vid)
    if (!p) return null
    return stateAt(sim, scen, drawer.at ?? p.etb).find((s) => s.v.id === drawer.vid) ?? null
  }, [drawer?.vid, drawer?.at, sim, scen]) // eslint-disable-line react-hooks/exhaustive-deps
  // 데이터에 비어 있던 계약 칸(통지 시간, 기상 공제 비율)은 화면 모델이 기본값을 채우므로 원본 요청에서 다시 본다.
  const raw = useMemo(() => (drawer && scen ? scen.request.vessels.find((x) => vesselIdOf(x) === drawer.vid) ?? null : null), [drawer?.vid, scen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!drawer || !sim || !me) return null
  const { v, p } = me
  const d = p.dem
  const berthOf = (id) => scen.berths.find((b) => b.id === id)
  const bname = (id) => berthOf(id)?.name ?? id
  const berth = berthOf(p.bid)
  const live = drawer.at !== null && drawer.at !== undefined
  const t = live ? drawer.at : p.etb
  const amt = (cents) => (isScheduler ? <span className="num">{money(cents)}</span> : '비공개')
  const rateText = isScheduler ? <span className="num">${v.contract.rateUsd.toLocaleString('en-US')}/일</span> : '비공개'
  const tourActive = tour.index !== null

  // 비교: 최저 체선료 후보(실제 접안 실적과는 비교하지 않는다, 11-25)
  const best = all[0]
  const bestP = best && best.id !== sim.id ? best.placements.find((x) => x.vid === v.id) : null

  const eta = p.eta ?? v.eta
  const rate = v.rates[p.bid]
  const steps = [
    { k: '도착 (ETA)', at: eta, f: '선박이 울산항에 도착하는 예정 시각입니다. 입항 신고 값입니다.' },
    { k: 'NOR 제출', at: v.nor, f: v.nor == null ? 'NOR 제출 시각 자료가 없습니다.' : '선장이 하역 준비가 끝났다고 알린 시각입니다.' },
    { k: '정박시간 개시', at: p.ls, f: '이 시각부터 허용 시간을 셉니다. NOR, LayCan, 계약 조건으로 정해집니다.' },
    { k: '접안', at: p.etb, f: `${berth?.name ?? p.bid}에 배를 댑니다. ${p.waitMin > 0 ? `도착 뒤 정박지에서 ${fmtDur(p.waitMin)} 기다릴 예정입니다.` : '도착 뒤 기다리지 않고 바로 댑니다.'}${p.night ? ' 야간 접안입니다.' : ''}${p.fixed ? ' 스케줄러가 고정한 자리입니다.' : ''}` },
    { k: '작업 시작', at: p.ws, f: '접안 뒤 호스를 연결하고 하역을 시작합니다.' },
    { k: '작업 완료', at: p.wf, f: `${v.product} ${v.ton.toLocaleString()} t ${v.dir} 작업이 끝납니다. 작업 ${fmtDur(p.wf - p.ws)}${rate ? `, 이 부두 하역 속도 ${Math.round(rate).toLocaleString()} t/h` : ''}.` },
    { k: '호스 분리', at: p.hose, f: '하역 호스를 뗍니다. 정박시간은 여기서 멈춥니다.' },
    { k: '정박시간 종료', at: p.le, f: `정박시간 개시에서 허용 시간 ${v.contract.laytimeH}시간이 지난 시각입니다. 호스 분리가 이보다 늦으면 그만큼 체선입니다.` },
    { k: '이안', at: p.etu, f: '부두를 떠납니다. 이 뒤로 다음 선박이 이 부두를 쓸 수 있습니다.' },
  ]

  // 시간 흐름 막대: 엔진 시각만 쓴다
  const marks = [eta, v.nor, p.ls, p.etb, p.hose, p.le, p.etu].filter((x) => x != null)
  // 11-25 축은 사건 구간마다 log(길이) 비율로 그린다: 긴 정박지 대기가 화면을 다 먹지 않고, 짧은 작업, 체선도 읽힌다.
  const stops = [...new Set(marks)].sort((a, b) => a - b)
  const wts = stops.slice(1).map((m, i) => Math.max(1.5, Math.log2(1 + (m - stops[i]) / 30)))
  const sum = wts.reduce((a, b) => a + b, 0) || 1
  const pos = (m) => {
    if (m <= stops[0]) return 0
    let acc = 0
    for (let i = 1; i < stops.length; i++) {
      if (m <= stops[i]) return (acc + wts[i - 1] * ((m - stops[i - 1]) / Math.max(1, stops[i] - stops[i - 1]))) / sum
      acc += wts[i - 1]
    }
    return 1
  }
  const X = (m) => `${(3 + pos(m) * 94).toFixed(2)}%`
  const W = (a, b) => `${Math.max(1.2, (pos(b) - pos(a)) * 94).toFixed(2)}%`
  // 그림 아래 시각 글자: 가까운 시각끼리 겹치지 않게 줄을 나눈다(왼쪽부터, 앞 글자와 GAP% 안이면 다음 줄)
  const TICK_GAP = 22, TICK_ROW_PX = 28
  const ticks = (() => {
    const ms = [{ k: '도착', at: eta }, { k: '접안', at: p.etb }, { k: '호스 분리', at: p.hose }, { k: '이안', at: p.etu }]
      .filter((m) => m.at != null).map((m) => ({ ...m, x: 3 + pos(m.at) * 94 })).sort((a, b) => a.x - b.x)
    const last = []
    for (const m of ms) {
      let row = last.findIndex((x) => m.x - x >= TICK_GAP)
      if (row < 0) row = last.length
      last[row] = m.x
      m.row = row
    }
    return { ms, h: Math.max(1, last.length) * TICK_ROW_PX + 2 }
  })()

  return (
    <Drawer
      isOpen position="right" size="460px" onClose={closeDrawer}
      className={`${dark} vessel-drawer`} portalClassName="vessel-drawer-portal"
      hasBackdrop={false} autoFocus={!tourActive} enforceFocus={!tourActive}
      canEscapeKeyClose={!tourActive} canOutsideClickClose={!tourActive}
    >
      <section className="vessel-drawer-root" data-tour="drawer" data-mode={view} role="dialog" aria-modal={!tourActive} aria-labelledby="vessel-drawer-title">
        <header className="vessel-drawer-head">
          <Icon icon="cargo-ship" size={15} className="muted" />
          <div>
            <h2 id="vessel-drawer-title">{v.name}{view === 'evidence' && <span>계획 일정</span>}</h2>
            <span className="vessel-drawer-ident">{live && <St tone={PHASE[me.phase].tone}>{PHASE[me.phase].label}</St>}<span className="muted">{v.nameEn ?? v.callSign}</span></span>
          </div>
          <Button icon="cross" variant="minimal" aria-label="닫기" onClick={closeDrawer} />
        </header>
        <nav className="vessel-drawer-tabs" aria-label="선박 카드 보기">
          {[['card', '요약'], ['contract', '계약'], ['evidence', '계획 일정'], ['notes', `메모 ${notesOf(scenarioId, v.id).length}`], ['history', `변경 이력 ${historyOf(scenarioId, v.id).length}`]].map(([id, label]) => (
            <button key={id} type="button" className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>
          ))}
        </nav>

        <div className="vessel-drawer-scroll" ref={scrollRef}>
          {view === 'card' ? <>
            {/* 11-25 한눈에: 도착 → 대기 → 접안, 작업 → 이안 흐름 위에 지금 어디인지. 제원과 갈 수 있는 부두는 접어 둔다 */}
            <div className="vc-flow" role="list" aria-label="입항 흐름">
              {[
                { k: 'arrive', label: '도착', at: eta, sub: '정박지' },
                { k: 'wait', label: '대기', dur: Math.max(0, p.etb - eta), sub: p.etb > eta ? fmtDur(p.etb - eta) : '없음' },
                { k: 'berth', label: '접안, 작업', at: p.etb, sub: berth?.label ?? p.bid },
                { k: 'leave', label: '이안', at: p.etu, sub: fmtDur(p.etu - p.etb) + ' 머묾' },
              ].map((step, i) => {
                const order = { coming: -1, waiting: 1, berthed: 2, left: 4 }[me.phase] ?? -1
                const state = !live ? 'todo' : i < order ? 'done' : i === order ? 'now' : 'todo'
                return (
                  <div key={step.k} role="listitem" className={`vc-step ${state}`}>
                    <span className="vc-dot" />
                    <span className="vc-label">{step.label}</span>
                    <b className="num">{step.at != null ? fmt(step.at) : step.sub}</b>
                    {step.at != null && <small>{step.sub}</small>}
                  </div>
                )
              })}
            </div>

            <div className="vc-facts">
              <div><span>화물</span><b>{v.product}</b><small>{v.dir}</small><small className="num">{v.ton.toLocaleString()} t</small></div>
              <div><span>배정 선석</span><b>{berth?.name ?? p.bid}</b></div>
              {isScheduler && <div className={d.cents > 0 ? 'dem' : 'ok'}><span>예상 체선</span><b className="num">{d.cents > 0 ? money(d.cents) : '없음'}</b><small>{d.cents > 0 ? fmtDur(d.excessMin) : '허용 시간 안'}</small></div>}
            </div>

            <details className="vc-more">
              <summary>선박 정보</summary>
              <dl className="vc-grid">
                <div><dt>영문 선명</dt><dd>{v.nameEn ?? '-'}</dd></div>
                <div><dt>호출부호, 항차</dt><dd className="mono">{v.callSign}, {Number(v.voyage)}항차</dd></div>
                <div><dt>선종</dt><dd>{v.cls ?? v.vtype ?? '-'}</dd></div>
                <div><dt>국적</dt><dd>{v.flag ?? '-'}</dd></div>
                <div><dt>DWT</dt><dd className="num">{v.dwt?.toLocaleString() ?? '-'} t</dd></div>
                <div><dt>GT</dt><dd className="num">{v.grt?.toLocaleString() ?? '-'}</dd></div>
                <div><dt>LOA, 폭</dt><dd className="num">{v.loa ?? '-'} m{v.web?.beam ? `, ${v.web.beam} m` : ''}</dd></div>
                <div><dt>흘수</dt><dd className="num">{v.draft ?? '-'} m</dd></div>
                {v.web?.built && <div><dt>건조</dt><dd className="num">{v.web.built}년</dd></div>}
                {v.web?.imo && <div><dt>IMO</dt><dd className="mono">{v.web.imo}</dd></div>}
              </dl>
            </details>

            <details className="vc-more">
              <summary>갈 수 있는 선석 <span className="num">{v.compat.length}</span></summary>
              <div className="vc-berths">{v.compat.map((id) => (
                <span key={id} className={`vc-berth ${id === p.bid ? 'on' : ''}`} title={v.rates[id] ? `하역 속도 ${Math.round(v.rates[id]).toLocaleString()} t/h` : ''}>
                  {berthOf(id)?.label ?? id}{id === p.bid && <em>배정</em>}
                </span>
              ))}</div>
            </details>
          </> : view === 'contract' ? <>
            <Panel code="CONTRACT" title="계약 조건">
              <Details rows={[
                ['허용 시간', <span className="num">{v.contract.laytimeH} h</span>],
                ['일 체선료', rateText],
                ['NOR 제출', v.nor != null ? <span className="num">{fmtFull(v.nor)}</span> : <span className="muted">자료 없음</span>],
                ['LayCan', v.laycan ? <><span className="num">{fmt(v.laycan.from)} ~ {fmt(v.laycan.to)}</span>{v.laycan.case && <span className="muted"> ({v.laycan.case})</span>}</> : <span className="muted">없음</span>],
                ['NOR 뒤 개시', raw?.notice_hours != null ? <span className="num">{raw.notice_hours} h</span> : <span className="muted">자료 없음</span>],
                ['기상 공제', raw?.weather_deduct_pct != null ? <span className="num">{raw.weather_deduct_pct}%</span> : <span className="muted">자료 없음</span>],
                ['CFR', v.contract.cfr ? '예' : '아니오'],
              ]} />
            </Panel>
          </> : view === 'evidence' ? <>
            <div className={`vd-verdict ${d.cents > 0 ? 'dem' : 'ok'}`}>
              <span className="vd-verdict-icon"><Icon icon={d.cents > 0 ? 'warning-sign' : 'tick'} size={18} /></span>
              <div>
                <span className="vd-verdict-k">{d.cents > 0 ? '예상 체선료' : '예상 체선 없음'}</span>
                <b className="num">{isScheduler ? money(d.cents) : d.cents > 0 ? fmtDur(d.excessMin) : '0'}</b>
                <p>{d.excessMin > 0
                  ? <>호스 분리가 허용 시간 끝보다 <b>{fmtDur(d.excessMin)}</b> 늦을 예정입니다.</>
                  : '허용 시간 안에 호스를 뗄 예정입니다.'}{d.weatherMin > 0 && ` 기상 ${fmtDur(d.weatherMin)}은 공제됩니다.`}</p>
              </div>
            </div>

            {/* 11-25 구간별 일정: 범례 없이 줄 이름과 칸 안의 글로 읽힌다 */}
            <Panel title="구간별 일정" pad>
              <div className="tf" role="img" aria-label={`도착 ${fmt(eta)}, 접안 ${fmt(p.etb)}, 정박시간 개시 ${fmt(p.ls)}, 호스 분리 ${fmt(p.hose)}, 체선 ${fmtDur(d.excessMin)}`}>
                <div className="tf-guides" aria-hidden="true" style={{ bottom: ticks.h }}>{[eta, p.etb, p.hose, p.etu].map((at, i) => <span key={i} className="tf-guide" style={{ left: X(at) }} />)}</div>
                <div className="tf-lane">
                  <span className="tf-name">배 위치</span>
                  <div className="tf-track">
                    {eta < p.etb && <div className="tf-seg wait" style={{ left: X(eta), width: W(eta, p.etb) }}><em>정박지 대기 {fmtDur(p.etb - eta)}</em></div>}
                    <div className="tf-seg work" style={{ left: X(p.etb), width: W(p.etb, p.etu) }}><em>부두 작업 {fmtDur(p.etu - p.etb)}</em></div>
                  </div>
                </div>
                <div className="tf-lane">
                  <span className="tf-name">허용 시간</span>
                  <div className="tf-track">
                    <div className="tf-seg lay" style={{ left: X(p.ls), width: W(p.ls, p.le) }}><em>{v.contract.laytimeH}시간, {fmt(p.ls).split(' ')[1]} 시작</em></div>
                  </div>
                </div>
                <div className="tf-lane">
                  <span className="tf-name">체선</span>
                  <div className="tf-track">
                    {d.excessMin > 0
                      ? <div className="tf-seg dem" style={{ left: X(p.le), width: W(p.le, p.hose) }}><em>{fmtDur(d.excessMin)} 초과</em></div>
                      : <span className="tf-none">없음</span>}
                  </div>
                </div>
                <div className="tf-axis">
                  <span className="tf-name" />
                  <div className="tf-track" style={{ height: ticks.h }}>
                    {ticks.ms.map((m) => <span key={m.k} className={`tf-tick ${m.x > 88 ? 'end' : m.x < 12 ? 'start' : ''}`} style={{ left: `${m.x.toFixed(2)}%`, top: 2 + m.row * TICK_ROW_PX }}><b>{m.k}</b><span className="num">{fmt(m.at)}</span></span>)}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="단계별 예정 시각">
              <ol className="vessel-drawer-calc">
                {steps.map((s, i) => <li key={s.k}>
                  <div className="vessel-drawer-step-head"><span className="vessel-drawer-step-no num">{i + 1}</span><b>{s.k}</b><strong className="num">{s.at == null ? '-' : fmt(s.at)}</strong></div>
                  <p>{s.f}</p>
                </li>)}
              </ol>
              <Details rows={[
                ['체선 시간', <><b className={d.excessMin > 0 ? 'c-red' : ''}>{fmtDur(d.excessMin)}</b></>],
                ['기상체선 시간', <>{d.weatherMin > 0 ? fmtDur(d.weatherMin) : '없음'}</>],
                ['일 체선료', rateText],
                ['체선료', <><b className={`num ${d.cents > 0 ? 'c-red' : 'c-green'}`}>{amt(d.cents)}</b></>],
              ]} />
            </Panel>

            {bestP && (
              <Panel title="최저안과 비교">
                <Details rows={[
                  [sim.label, <>{bname(p.bid)}, 접안 <span className="num">{fmt(p.etb)}</span>, 체선료 {amt(d.cents)}</>],
                  bestP && [`최저안 ${best.label}`, <>{bname(bestP.bid)}, 접안 <span className="num">{fmt(bestP.etb)}</span>, 체선료 {amt(bestP.dem.cents)}</>],
                ]} />
              </Panel>
            )}
          </> : view === 'notes'
            ? <VesselNotes scenarioId={scenarioId} vessel={v} canWrite={isScheduler} />
            : <VesselHistory scenarioId={scenarioId} vessel={v} />}
        </div>
      </section>
    </Drawer>
  )
}

const PEOPLE = ['스케줄러 A', '이용자 B', '대리점 담당', '3부두 하역 1팀']
const mentionsOf = (text) => PEOPLE.filter((p) => text.includes(`@${p}`))
const withMentions = (text) => text.split(new RegExp(`(@(?:${PEOPLE.join('|')}))`)).map((part, i) => (part.startsWith('@') && PEOPLE.includes(part.slice(1)) ? <b key={i} className="vd-mention">{part}</b> : part))

/** 선박 메모: 현장 연락, 특이사항. 공유 범위, 작성자(역할), @태그 알림을 보인다. 스케줄러만 쓰고, 자기 메모만 지운다. */
function VesselNotes({ scenarioId, vessel, canWrite }) {
  const [text, setText] = useState('')
  const me = role()?.name
  const notes = [...notesOf(scenarioId, vessel.id)].reverse()
  const submit = () => {
    const t = text.trim()
    if (!t) return
    addNote(scenarioId, vessel.id, vessel.name, t)
    setText('')
  }
  const tag = (p) => setText((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}@${p} `)
  return (
    <Panel code="NOTES" title="메모">
      {canWrite && (
        <div className="vessel-notes-form">
          <TextArea fill rows={3} value={text} placeholder="예: @대리점 담당 NOR 제출 예정 시각 변동 없음 확인 부탁" aria-label="메모 내용"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }} />
          <div className="vd-tags">{PEOPLE.map((p) => <button type="button" key={p} onClick={() => tag(p)}>@{p}</button>)}</div>
          <div className="vessel-notes-actions">
            <Button size="small" intent="primary" icon="add" disabled={!text.trim()} onClick={submit}>메모 추가</Button>
          </div>
        </div>
      )}
      {notes.length ? (
        <ul className="vessel-notes">
          {notes.map((n) => (
            <li key={n.id}>
              <div className="vessel-notes-meta tiny"><b>{n.who}</b><span className="faint">선박 스케줄러</span><span className="num faint">{n.at}</span>
                {canWrite && n.who === me && <Button size="small" variant="minimal" icon="trash" aria-label="메모 삭제" onClick={() => removeNote(scenarioId, vessel.id, vessel.name, n.id)} />}
              </div>
              <p className="small">{withMentions(n.text)}</p>
              {mentionsOf(n.text).length > 0 && <p className="tiny c-accent">알림 보냄: {mentionsOf(n.text).join(', ')}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="small muted vessel-notes-empty">아직 메모가 없습니다.</p>}
    </Panel>
  )
}

/** 변경 이력: 이 선박의 입력(ETA, 고정)이 언제 누구에 의해 어떻게 바뀌었는지. */
function VesselHistory({ scenarioId, vessel }) {
  const list = [...historyOf(scenarioId, vessel.id)].reverse()
  const etaCount = list.filter((h) => h.field === 'eta').length
  return (
    <Panel code="HISTORY" title="변경 이력">
      {list.length ? (
        <ol className="vessel-history">
          {list.map((h) => (
            <li key={h.id}>
              <div className="vessel-notes-meta tiny"><b>{h.label}</b><span className="faint">{h.who}, <span className="num">{h.at}</span></span></div>
              <p className="small"><span className="muted">{h.from}</span> <Icon icon="arrow-right" size={11} className="faint" /> <span className="c-blue strong">{h.to}</span></p>
            </li>
          ))}
        </ol>
      ) : <p className="small muted vessel-notes-empty">바뀐 입력이 없습니다.</p>}
    </Panel>
  )
}
