// 선박 카드 (11-24 실데이터): 데이터 팀 묶음에 있는 값과 팀 엔진(CP-SAT)이 낸 시각, 체선료만 보인다.
// 화면에서 체선료를 다시 계산하지 않는다. 산출 근거는 엔진 결과의 시각을 순서대로 풀어 쓴 것이다.
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

  // 비교: 최저 체선료 후보, 실제 계획(실제 부두, 실제 접안)
  const best = all[0]
  const bestP = best && best.id !== sim.id ? best.placements.find((x) => x.vid === v.id) : null
  const baseP = result.baseline?.placements.find((x) => x.vid === v.id) ?? null
  const actual = baseP ? { bid: baseP.bid, etb: baseP.etb, etu: baseP.etu, cents: baseP.dem.cents } : v.actual ? { ...v.actual, cents: null } : null

  const eta = p.eta ?? v.eta
  const rate = v.rates[p.bid]
  const steps = [
    { k: '도착 (ETA)', at: eta, f: '선박이 울산항에 도착하는 예정 시각입니다. 입항 신고 값입니다.' },
    { k: 'NOR 제출', at: v.nor, f: v.nor == null ? 'NOR 제출 시각 자료가 없습니다.' : '선장이 하역 준비가 끝났다고 알린 시각입니다.' },
    { k: '정박시간 개시', at: p.ls, f: '이 시각부터 허용 시간을 셉니다. 엔진이 NOR, LayCan, 계약 조건으로 정한 값입니다.' },
    { k: '접안', at: p.etb, f: `${berth?.name ?? p.bid}에 배를 댑니다. ${p.waitMin > 0 ? `도착 뒤 정박지에서 ${fmtDur(p.waitMin)} 기다렸습니다.` : '도착 뒤 기다리지 않았습니다.'}${p.night ? ' 야간 접안입니다.' : ''}${p.fixed ? ' 스케줄러가 고정한 자리입니다.' : ''}` },
    { k: '작업 시작', at: p.ws, f: '접안 뒤 호스를 연결하고 하역을 시작합니다.' },
    { k: '작업 완료', at: p.wf, f: `${v.product} ${v.ton.toLocaleString()} t ${v.dir} 작업이 끝납니다. 작업 ${fmtDur(p.wf - p.ws)}${rate ? `, 이 부두 하역 속도 ${Math.round(rate).toLocaleString()} t/h` : ''}.` },
    { k: '호스 분리', at: p.hose, f: '하역 호스를 뗍니다. 정박시간은 여기서 멈춥니다.' },
    { k: '정박시간 종료', at: p.le, f: `정박시간 개시에서 허용 시간 ${v.contract.laytimeH}시간이 지난 시각입니다. 호스 분리가 이보다 늦으면 그만큼 체선입니다.` },
    { k: '이안', at: p.etu, f: '부두를 떠납니다. 이 뒤로 다음 선박이 이 부두를 쓸 수 있습니다.' },
  ]

  // 시간 흐름 막대: 엔진 시각만 쓴다
  const marks = [eta, v.nor, p.ls, p.etb, p.hose, p.le, p.etu].filter((x) => x != null)
  const t0 = Math.min(...marks) - 120
  const t1 = Math.max(...marks) + 120
  const X = (m) => `${(2 + ((m - t0) / (t1 - t0)) * 96).toFixed(2)}%`
  const W = (a, b) => `${Math.max(0.4, ((b - a) / (t1 - t0)) * 96).toFixed(2)}%`

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
            <h2 id="vessel-drawer-title">{v.name}{view === 'evidence' && <span>체선료 산출 근거</span>}</h2>
            <span className="vessel-drawer-ident"><span className="mono">{v.id}</span><span className="muted">{sim.label}</span></span>
          </div>
          <Button icon="cross" variant="minimal" aria-label="닫기" onClick={closeDrawer} />
        </header>
        <nav className="vessel-drawer-tabs" aria-label="선박 카드 보기">
          {[['card', '제원'], ['contract', '계약'], ['evidence', '산출 근거'], ['notes', `메모 ${notesOf(scenarioId, v.id).length}`], ['history', `변경 이력 ${historyOf(scenarioId, v.id).length}`]].map(([id, label]) => (
            <button key={id} type="button" className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>{label}</button>
          ))}
        </nav>

        <div className="vessel-drawer-scroll" ref={scrollRef}>
          {view === 'card' ? <>
            <div className="vd-key">
              {live && <div className="vd-key-row"><span>상태</span><b><St tone={PHASE[me.phase].tone}>{PHASE[me.phase].label}</St> <span className="vd-key-sub num">{fmt(t)} 기준</span></b></div>}
              <div className="vd-key-row"><span>접안</span><b>{berth?.name ?? p.bid}, <span className="num">{fmt(p.etb)}</span>{live && p.etb > t && <span className="vd-key-sub"> ({fmtDur(p.etb - t)} 뒤)</span>}</b></div>
              <div className="vd-key-row"><span>이안</span><b className="num">{fmt(p.etu)}</b></div>
              {isScheduler && <div className="vd-key-row"><span>예상 체선</span><b className={d.cents > 0 ? 'c-red' : 'c-green'}>{d.cents > 0 ? <>{fmtDur(d.excessMin)}, <span className="num">{money(d.cents)}</span></> : '없음 (허용 시간 안)'}</b>
                <Button size="small" variant="minimal" endIcon="arrow-right" text="근거" onClick={() => setView('evidence')} /></div>}
            </div>

            <Panel code="VESSEL-SPEC" title="제원">
              <Details rows={[
                ['호출부호', <span className="mono">{v.callSign}</span>],
                ['항차', <span className="num">{v.voyage}</span>],
                ['선종', <>{v.vtype}{v.cls ? <span className="muted">, {v.cls}</span> : null}</>],
                ['DWT, GRT', <span className="num">{v.dwt?.toLocaleString() ?? '-'} t, {v.grt?.toLocaleString() ?? '-'}</span>],
                ['흘수, LOA', <span className="num">{v.draft ?? '-'} m, {v.loa ?? '-'} m</span>],
                ['화물', <>{v.product} <span className="mono faint">{v.cargo}</span>, {v.dir}, <span className="num">{v.ton.toLocaleString()} t</span></>],
                v.material && ['자재 코드', <span className="mono">{v.material}</span>],
                v.workHours != null && ['작업 시간(자료)', <span className="num">{v.workHours} h</span>],
              ]} />
            </Panel>

            <Panel code="BERTH-FIT" title="갈 수 있는 부두" desc="부두별 하역 속도는 데이터 팀 묶음 값">
              <table className="dt vd-rates">
                <thead><tr><th>부두</th><th className="r">하역 속도</th><th /></tr></thead>
                <tbody>{v.compat.map((id) => (
                  <tr key={id} className={id === p.bid ? 'on' : ''}>
                    <td>{bname(id)}</td>
                    <td className="num r">{v.rates[id] ? `${Math.round(v.rates[id]).toLocaleString()} t/h` : '-'}</td>
                    <td className="small muted">{id === p.bid ? '이 계획' : actual?.bid === id ? '실제 계획' : ''}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Panel>

            <Panel code="PLAN" title="접안 계획">
              <Details rows={[
                [sim.label, <>{berth?.name ?? p.bid}, 접안 <span className="num">{fmt(p.etb)}</span> → 이안 <span className="num">{fmt(p.etu)}</span>{p.waitMin > 0 && <><br /><span className="muted">정박지 대기 {fmtDur(p.waitMin)}</span></>}{isScheduler && <><br />체선료 {amt(d.cents)}</>}</>],
                actual && ['실제 계획', <>{bname(actual.bid)}, 접안 <span className="num">{fmt(actual.etb)}</span> → 이안 <span className="num">{fmt(actual.etu)}</span>{isScheduler && actual.cents != null && <><br />체선료 {amt(actual.cents)}</>}</>],
              ]} />
            </Panel>
          </> : view === 'contract' ? <>
            <Panel code="CONTRACT" title="계약 조건" desc="계약 값은 가상(데이터 팀 묶음), 계획 조건에서 고칠 수 없음">
              <Details rows={[
                ['허용 시간', <span className="num">{v.contract.laytimeH} h</span>],
                ['일 체선료', rateText],
                ['NOR 제출', v.nor != null ? <span className="num">{fmtFull(v.nor)}</span> : <span className="muted">자료 없음</span>],
                ['LayCan', v.laycan ? <><span className="num">{fmt(v.laycan.from)} ~ {fmt(v.laycan.to)}</span>{v.laycan.case && <span className="muted"> ({v.laycan.case})</span>}</> : <span className="muted">없음</span>],
                ['NOR 뒤 개시', raw?.notice_hours != null ? <span className="num">{raw.notice_hours} h</span> : <span className="muted">자료 없음, 엔진 기본값으로 계산</span>],
                ['기상 공제', raw?.weather_deduct_pct != null ? <span className="num">{raw.weather_deduct_pct}%</span> : <span className="muted">자료 없음, 엔진 기본값으로 계산</span>],
                ['CFR', v.contract.cfr ? '예' : '아니오'],
              ]} />
            </Panel>
          </> : view === 'evidence' ? <>
            <div className="vd-conclusion">
              <span className="tiny muted">결론</span>
              <b className={`num ${d.cents > 0 ? 'c-red' : 'c-green'}`}>{isScheduler ? money(d.cents) : d.cents > 0 ? '체선 있음' : '체선 없음'}</b>
              <p className="small">{d.excessMin > 0
                ? <>호스 분리가 정박시간 종료보다 늦어 체선 <b>{fmtDur(d.excessMin)}</b>이 생겼습니다.</>
                : '허용 시간 안에 호스를 뗐습니다.'}{d.weatherMin > 0 && ` 기상 구간이 정박시간과 ${fmtDur(d.weatherMin)} 겹쳐, 계약 공제율만큼 체선 시간에서 뺐습니다.`}</p>
            </div>

            <Panel code="TIME-FLOW" title="시간 흐름" pad>
              <div className="vessel-drawer-flow" role="img" aria-label={`도착 ${fmt(eta)}, 접안 ${fmt(p.etb)}, 정박시간 개시 ${fmt(p.ls)}, 호스 분리 ${fmt(p.hose)}, 체선 ${fmtDur(d.excessMin)}`}>
                <div className="vessel-drawer-axis" />
                {eta < p.etb && <div className="vessel-drawer-segment wait" style={{ left: X(eta), width: W(eta, p.etb) }} />}
                <div className="vessel-drawer-segment work" style={{ left: X(p.etb), width: W(p.etb, p.etu) }} />
                <div className="vessel-drawer-segment lay" style={{ left: X(p.ls), width: W(p.ls, Math.min(p.le, p.hose)) }} />
                {d.excessMin > 0 && <div className="vessel-drawer-segment dem" style={{ left: X(p.le), width: W(p.le, p.hose) }} />}
                <span className="vessel-drawer-tick" style={{ left: X(eta) }}>ETA <span className="num">{fmt(eta).slice(6)}</span></span>
                <span className="vessel-drawer-tick end" style={{ left: X(p.hose) }}>호스 분리 <span className="num">{fmt(p.hose).slice(6)}</span></span>
                <span className="vessel-drawer-tick bottom" style={{ left: X(p.ls) }}>정박시간 개시</span>
              </div>
              <p className="vessel-drawer-legend"><span>점선 대기</span>, <span className="c-blue">파랑 접안~이안</span>, <span className="c-green">초록 허용 시간 안</span>, <span className="c-red">빨강 체선</span></p>
            </Panel>

            <Panel code="CALC-STEPS" title="엔진 시각 순서" desc="모든 시각과 금액은 팀 엔진(CP-SAT) 결과">
              <ol className="vessel-drawer-calc">
                {steps.map((s, i) => <li key={s.k}>
                  <div className="vessel-drawer-step-head"><span className="vessel-drawer-step-no num">{i + 1}</span><b>{s.k}</b><strong className="num">{s.at == null ? '-' : fmt(s.at)}</strong></div>
                  <p>{s.f}</p>
                </li>)}
              </ol>
              <Details rows={[
                ['체선 시간', <><b className={d.excessMin > 0 ? 'c-red' : ''}>{fmtDur(d.excessMin)}</b><br /><span className="muted">호스 분리 − 정박시간 종료 − 기상 공제, 0보다 작으면 0</span></>],
                ['기상체선 시간', <>{d.weatherMin > 0 ? fmtDur(d.weatherMin) : '없음'}<br /><span className="muted">부두 사용 불가의 기상 구간이 정박시간 개시~호스 분리와 겹친 시간(공제 전). 여기에 계약 공제율(자료 없으면 50%)을 곱해 뺍니다</span></>],
                ['일 체선료', rateText],
                ['체선료', <><b className={`num ${d.cents > 0 ? 'c-red' : 'c-green'}`}>{amt(d.cents)}</b><br /><span className="muted">체선 시간 ÷ 24시간 × 일 체선료, 엔진이 센트 단위로 계산</span></>],
              ]} />
            </Panel>

            {(bestP || actual) && (
              <Panel code="COMPARE" title="다른 계획과 비교">
                <Details rows={[
                  [sim.label, <>{bname(p.bid)}, 접안 <span className="num">{fmt(p.etb)}</span>, 체선료 {amt(d.cents)}</>],
                  bestP && [`최저안 ${best.label}`, <>{bname(bestP.bid)}, 접안 <span className="num">{fmt(bestP.etb)}</span>, 체선료 {amt(bestP.dem.cents)}
                    <br /><span className="muted">{bestP.bid === p.bid && bestP.etb === p.etb ? '이 선박은 최저안과 같습니다.' : `${bestP.bid !== p.bid ? '부두가 다르고, ' : ''}접안이 ${bestP.etb === p.etb ? '같습니다' : `${fmtDur(Math.abs(p.etb - bestP.etb))} ${p.etb > bestP.etb ? '늦습니다' : '빠릅니다'}`}.`}</span></>],
                  actual && ['실제 계획', <>{bname(actual.bid)}, 접안 <span className="num">{fmt(actual.etb)}</span>{actual.cents != null && <>, 체선료 {amt(actual.cents)}</>}
                    <br /><span className="muted">실제 접안 실적을 같은 엔진 규칙으로 계산한 값</span></>],
                ]} />
              </Panel>
            )}
          </> : view === 'notes'
            ? <VesselNotes scenarioId={scenarioId} vessel={v} canWrite={isScheduler} />
            : <VesselHistory scenarioId={scenarioId} vessel={v} />}
        </div>
        <footer className="vessel-drawer-footer">출처: {scen.summary}</footer>
      </section>
    </Drawer>
  )
}

const PEOPLE = ['스케줄러 A', '이용자 B', '대리점 담당', 'SK 3부두 하역 1팀']
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
    <Panel code="NOTES" title="메모" desc="공유: 이 선박을 보는 스케줄러 전원, 이용자에게는 안 보임">
      {canWrite && (
        <div className="vessel-notes-form">
          <TextArea fill rows={3} value={text} placeholder="예: @대리점 담당 NOR 제출 예정 시각 변동 없음 확인 부탁" aria-label="메모 내용"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }} />
          <div className="vd-tags"><span className="tiny muted">태그하면 알림이 갑니다</span>{PEOPLE.map((p) => <button type="button" key={p} onClick={() => tag(p)}>@{p}</button>)}</div>
          <div className="vessel-notes-actions">
            <span className="tiny faint">Ctrl/⌘ + Enter로 추가</span>
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
    <Panel code="HISTORY" title="변경 이력" desc={`ETA 변경 ${etaCount}회, 전체 ${list.length}건`}>
      {list.length ? (
        <ol className="vessel-history">
          {list.map((h) => (
            <li key={h.id}>
              <div className="vessel-notes-meta tiny"><b>{h.label}</b><span className="faint">{h.who}, <span className="num">{h.at}</span></span></div>
              <p className="small"><span className="muted">{h.from}</span> <Icon icon="arrow-right" size={11} className="faint" /> <span className="c-blue strong">{h.to}</span></p>
            </li>
          ))}
        </ol>
      ) : <p className="small muted vessel-notes-empty">바뀐 입력이 없습니다. 계획 조건에서 ETA를 고치거나 선박을 고정하면 여기에 남습니다.</p>}
    </Panel>
  )
}
