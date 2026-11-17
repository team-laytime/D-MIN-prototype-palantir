import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Drawer, Icon } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { RULES, compatibleBerths, stateAt } from '../lib/engine.js'
import { NAV, anchorageFor, positionOf } from '../lib/vesselState.js'
import { fmt, fmtDur, money } from '../lib/time.js'
import { Panel, St } from '../ui/kit.jsx'
import './drawer.css'

const yearTime = (minutes) => `26-${fmt(minutes).replace('/', '-')}`
const weatherLabel = { FULL: '기상 대기 전부 공제', HALF: '기상 대기 50% 공제', NONE: '공제 없음' }
const phaseTone = { coming: 'live', waiting: 'warn', berthed: 'ok', left: 'idle' }

function Details({ rows }) {
  return (
    <table className="vessel-drawer-kv">
      <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody>
    </table>
  )
}

/** 원본의 도식·계약·AIS 정보는 그대로 두고 금액 조회 권한만 useApp()에서 읽는다. */
export default function VesselDrawer() {
  const { drawer, drawerSim: sim, result, scen, closeDrawer, isScheduler, tour } = useApp()
  const [view, setView] = useState(drawer?.mode ?? 'card')
  const scrollRef = useRef(null)
  useEffect(() => { setView(drawer?.mode ?? 'card') }, [drawer?.simId, drawer?.vid, drawer?.mode])
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [view])

  const liveState = useMemo(() => {
    if (!drawer || !sim) return null
    const placement = sim.placements.find((x) => x.vid === drawer.vid)
    if (!placement) return null
    const all = stateAt(sim, scen, drawer.at ?? placement.etb).sort((a, b) => a.v.eta - b.v.eta)
    const me = all.find((s) => s.v.id === drawer.vid)
    const waiting = all.filter((s) => s.phase === 'waiting' && anchorageFor(s.v).id === anchorageFor(me.v).id)
    return { ...me, spot: Math.max(0, waiting.findIndex((s) => s.v.id === drawer.vid)) }
  }, [drawer?.vid, drawer?.at, sim, scen])

  if (!drawer || !sim || !liveState) return null
  const v = liveState.v
  const p = liveState.p
  const d = p.dem
  const base = result.fcfs.placements.find((x) => x.vid === v.id)
  const berth = scen.berths.find((b) => b.id === p.bid)
  const berthName = (id) => scen.berths.find((b) => b.id === id)?.name ?? id
  const live = drawer.at !== null
  const t = drawer.at ?? p.etb
  const nav = NAV[liveState.phase]
  const pos = positionOf(liveState, scen, liveState.spot)
  const rate = (cents) => isScheduler ? <span className="num">{money(cents)}</span> : '비공개'
  const where = liveState.phase === 'coming' ? '입항 전 (항해)'
    : liveState.phase === 'waiting' ? `${anchorageFor(v).label} 대기`
      : liveState.phase === 'berthed' ? `${berth.name} 계류` : '출항'
  const use = liveState.phase === 'berthed' ? `${berth.name} 사용 중 (${fmt(p.etb)} ~)`
    : liveState.phase === 'left' ? `${berth.name} 사용 끝 (${fmt(p.etu)} 작업 종료)` : '-'
  const etaGap = v.aisEtaDiff
  const etaDrift = Math.abs(etaGap) >= 120
  const untilEta = live && liveState.phase === 'coming' ? v.eta - t : null
  const gapText = etaGap === 0 ? '계획과 같음' : `계획보다 ${fmtDur(Math.abs(etaGap))} ${etaGap > 0 ? '늦음' : '빠름'}`
  const tourActive = tour.index !== null
  const etbDiff = p.etb - base.etb
  const feeDiff = d.cents - base.dem.cents
  const steps = [
    { rule: 'ETA', k: '도착 (NOR)', f: `NOR 제출 ${fmt(v.eta)}`, val: fmt(v.eta), numeric: true },
    { rule: p.binding, k: '접안 (ETB)', f: p.blockers.length ? `${p.blockers.map((b) => RULES[b.rule].label).join(' · ')} → ${fmt(d.etb)} 접안` : `제약 없음 → ${fmt(d.etb)} 접안`, val: fmt(d.etb), numeric: true },
    { rule: d.ltStartRule, k: '정박개시', f: d.turnMin > 0 ? `min(NOR + ${v.contract.norTurnH}시간, 접안)` : 'NOR 제출 즉시', val: fmt(d.ltStart), numeric: true },
    { rule: 'LT-END-WORK', k: '정박종료', f: '작업 종료(호스 분리)', val: fmt(d.etu), numeric: true },
    { rule: d.clause.rule, k: '기상 공제', f: d.wxOverlap ? `대기 중 기상 악화 ${fmtDur(d.wxOverlap)} × ${d.clause.ratio * 100}%` : '정박시간 중 기상 대기 없음', val: d.wxDeduct ? `− ${fmtDur(d.wxDeduct)}` : '0' },
    { rule: '-', k: '산입 시간', f: `사용 ${fmtDur(d.usedMin)} − 공제`, val: fmtDur(d.countedMin) },
    { rule: '-', k: '체선 시간', f: `산입 − 허용 ${fmtDur(d.allowMin)} (0 미만은 0)`, val: fmtDur(d.excessMin) },
    { rule: 'DEM-PRORATA', k: '체선료', f: <>{fmtDur(d.excessMin)} ÷ 24시간 × {rate(d.rateCents)}/일</>, val: money(d.cents), numeric: true, strong: true },
  ]
  const allowEnd = d.ltStart + d.allowMin + d.wxDeduct
  const t0 = Math.min(v.eta, d.ltStart) - 120
  const t1 = Math.max(d.etu, allowEnd) + 120
  const X = (m) => `${(2 + ((m - t0) / (t1 - t0)) * 96).toFixed(2)}%`
  const W = (a, b) => `${Math.max(0.4, ((b - a) / (t1 - t0)) * 96).toFixed(2)}%`

  return (
    <Drawer
      isOpen position="right" size="460px" onClose={closeDrawer}
      className="bp6-dark vessel-drawer" portalClassName="vessel-drawer-portal"
      hasBackdrop={!tourActive} autoFocus={!tourActive} enforceFocus={!tourActive}
      canEscapeKeyClose={!tourActive} canOutsideClickClose={!tourActive}
    >
      <section className="vessel-drawer-root" data-tour="drawer" data-mode={view} role="dialog" aria-modal={!tourActive} aria-labelledby="vessel-drawer-title">
        <header className="vessel-drawer-head">
          <Icon icon="star-empty" size={15} className="muted" />
          <div>
            <h2 id="vessel-drawer-title">{v.name}{view === 'evidence' && <span> — 체선료 산출 근거</span>}</h2>
            <span className="vessel-drawer-ident"><span className="mono">{v.id} / {v.imo}</span><span className="muted">{sim.label}</span></span>
          </div>
          <Button icon="cross" variant="minimal" aria-label="닫기" onClick={closeDrawer} />
        </header>

        <div className="vessel-drawer-scroll" ref={scrollRef}>
          {view === 'card' ? <>
            <div className="vessel-drawer-position">
              <div><span>{live ? '현재 위치' : '계획 위치'}</span><b>위치 : {where}</b><small>ETA : <span className="num">{yearTime(v.eta)}</span></small></div>
              <div><span>접안 계획 · {sim.label}</span><b>{berth.name} 접안</b><small>ETB : <span className="num">{yearTime(p.etb)}</span></small></div>
            </div>
            <p className="vessel-drawer-time">{live ? '기준 시각' : '계획 기준'} : <span className="num">2026-{fmt(t).replace('/', '-')}</span>{!live && ' (접안 시점)'}</p>
            <div className="vessel-drawer-profile">
              <div className="vessel-drawer-dimensions">
                <span>톤수 <b className="num">{v.grt.toLocaleString()}t</b></span><span>흘수 <b className="num">{v.draft}m</b></span>
                <span>길이 <b className="num">{v.loa}m</b></span><span>폭 <b className="num">{v.beam}m</b></span>
              </div>
              <svg viewBox="0 0 400 70" height="70" preserveAspectRatio="none" role="img" aria-label="선박 측면 제원 개략도">
                <path d="M0 59 H400 M0 65 H400" className="vessel-drawer-water" />
                <path d="M70 30 H318 Q338 33 346 44 Q338 56 318 58 H86 Q72 52 70 44 Z" className="vessel-drawer-hull" />
                <path d="M74 44 H344 M130 27 H300" className="vessel-drawer-ship-line" />
                <rect x="84" y="14" width="36" height="16" className="vessel-drawer-cabin" /><path d="M88 20 H116 M92 14 V6 H102 V14" className="vessel-drawer-ship-line" />
              </svg>
            </div>
            <div className="vessel-drawer-alert">
              <span className={liveState.ticking ? 'c-red strong' : d.cents > 0 ? 'c-amber' : 'muted'}>
                {liveState.ticking ? <>체선 발생 중 · 누적 <span className="num">{money(liveState.cents)}</span></>
                  : d.cents > 0 ? <>예상 체선 {fmtDur(d.excessMin)} · <span className="num">{money(d.cents)}</span></>
                    : '허용 정박시간 안에 작업 종료 예정'}
              </span>
              <Button size="small" variant="outlined" text="체선료 산출 근거" onClick={() => setView('evidence')} />
            </div>

            <Panel code="VESSEL-ID" title="선박 정보">
              <Details rows={[
                ['국적', v.flag],
                ['선박명', <>{v.name} <span className="muted">(가상 선명)</span></>],
                ['MMSI', <span className="num">{v.mmsi}</span>],
                ['IMO · 호출부호', <span className="mono">{v.imo} · {v.callSign}</span>],
                ['선박 타입', v.type],
                ['선박 위치', <span className="num">{pos[0].toFixed(5)}, {pos[1].toFixed(5)}</span>],
                ['DWT · 흘수', <span className="num">{v.dwt.toLocaleString()} t · {v.draft} m</span>],
                ['화물', <>{v.dir} · {v.product} · <span className="num">{v.ton.toLocaleString()} t</span></>],
                ['계약', <><span className="mono">{v.contract.id}</span> · 허용 <span className="num">{v.contract.laytimeH}h</span> · 일 {rate(v.contract.rateUsd * 100)}</>],
                ['시설 신청', <>{compatibleBerths(v, scen).map(berthName).join(', ')} <span className="muted">(접안 가능 · 항차 <span className="mono">{v.voyage}</span>)</span></>],
                ['시설 사용', use],
                ['접안 계획', <>{berth.name} · ETB <span className="num">{fmt(p.etb)}</span> → ETU <span className="num">{fmt(p.etu)}</span><br /><span className="muted">{sim.label}{p.waitMin > 0 && ` · 접안 전 대기 ${fmtDur(p.waitMin)}`}</span></>],
                ['예상 체선료', <><b className={`num ${d.cents > 0 ? 'c-red' : 'c-green'}`}>{money(d.cents)}</b><br /><span className="muted">(체선 {fmtDur(d.excessMin)} · 일 {rate(v.contract.rateUsd * 100)})</span>{sim.id !== 'FCFS' && <><br /><span className="muted">도착순 기준안 <span className="num">{money(base.dem.cents)}</span></span></>}</>],
              ]} />
            </Panel>

            <div className="vessel-drawer-route">
              <div><span>출발지</span><b>{v.prevPort}</b></div>
              <Icon icon="arrow-right" size={18} className="muted" />
              <div><span>목적지</span><b>ULSAN, KOREA</b></div>
            </div>
            <div className="vessel-drawer-navigation">
              <div><span>Status</span><b>{live ? <St tone={phaseTone[liveState.phase]}>{nav.status}</St> : '-'}</b></div>
              <div><span>Speed</span><b className="num">{live ? `${nav.sog.toFixed(1)}kn` : '-'}</b></div>
              <div><span>Course</span><b className="num">{live ? `${nav.cog}°` : '-'}</b></div>
            </div>

            <Panel code="AIS-ETA" title="입항 · ETA" desc="AIS 항해 정보 · 선장 입력">
              <Details rows={[
                ['목적지', <>{v.aisDest} <span className="muted">(AIS 신고값)</span></>],
                ['계획 ETA', <><span className="num">{yearTime(v.eta)}</span><br /><span className="muted">(대리점 통보 · 계산에 쓰는 값)</span></>],
                ['AIS ETA', <><span className="num">{yearTime(v.eta + etaGap)}</span><br /><span className={etaDrift ? 'c-red strong' : 'muted'}>{gapText}</span>{etaDrift && <><br /><span className="c-red">2시간 넘게 달라 접안 계획을 다시 계산해야 합니다 <span className="mono">(N-002)</span></span></>}</>],
                ...(untilEta !== null ? [['도착까지', <>{untilEta > 0 ? fmtDur(untilEta) : '도착 시각 경과'}{untilEta > 0 && <> · 약 <span className="num">{Math.round(untilEta / 60 * nav.sog)}nm</span> <span className="muted">(<span className="num">{nav.sog.toFixed(1)}kn</span> 기준)</span></>}</>]] : []),
              ]} />
            </Panel>

            <Panel code="VESSEL-SPEC" title="선박 제원" desc="AIS 정적 정보 · 선박 원부 · 대리점 자료">
              <Details rows={[
                ['선종', <>{v.type} <span className="muted">· {v.flag} 선적 · <span className="num">{v.built}</span>년 건조 (선령 <span className="num">{2026 - v.built}</span>년)</span></>],
                ['선급', v.cls],
                ['톤수', <>총톤수(GT) <span className="num">{v.grt.toLocaleString()}</span> · 순톤수(NT) <span className="num">{v.nt.toLocaleString()}</span> · DWT <span className="num">{v.dwt.toLocaleString()} t</span></>],
                ['치수', <>길이(LOA) <span className="num">{v.loa} m</span> · 폭 <span className="num">{v.beam} m</span> · 형심 <span className="num">{v.depth} m</span> · 흘수 <span className="num">{v.draft} m</span></>],
                ['기관 · 속력', <>{v.engine} <span className="muted">· 서비스 속력 <span className="num">{v.speedKn}kn</span></span></>],
                ['화물창', <>탱크 <span className="num">{v.tanks}</span>개 · 용량 <span className="num">{v.cargoM3.toLocaleString()} ㎥</span> · 매니폴드 {v.manifold}</>],
                ['양하 능력', <><span className="num">{v.pump.toLocaleString()} t/h</span> <span className="muted">(부대작업 포함 작업 시간 {fmtDur(v.workMin)})</span></>],
                ['소유 · 관리', <>{v.owner}<br /><span className="muted">관리사 {v.manager}</span></>],
                ['기상 공제', <>{weatherLabel[v.contract.weather]} <span className="muted">(계약 <span className="mono">{v.contract.id}</span>)</span></>],
              ]} />
            </Panel>
            <p className="vessel-drawer-note">선명 · MMSI · IMO · 소유사는 모두 가상입니다. 실제 솔루션에서는 AIS(위치·ETA·길이·폭), 울산항만공사 공공 API(항차·입출항), 대리점 자료(톤수·탱크·소유)에서 채웁니다.</p>
            <Button fill intent="primary" endIcon="arrow-right" text="체선료 산출 근거 보기" onClick={() => setView('evidence')} />
          </> : <>
            <Button className="vessel-drawer-back" size="small" variant="minimal" icon="arrow-left" text="선박 정보" onClick={() => setView('card')} />
            <Panel code="LAYTIME" title="체선료 산출 근거">
              <Details rows={[
                ['계획', sim.label],
                ['부두 · 접안', <>{berth.name} · ETB <span className="num">{fmt(p.etb)}</span> → ETU <span className="num">{fmt(p.etu)}</span></>],
                ['정박 시간', <><span className="num">{fmt(d.ltStart)} ~ {fmt(d.etu)}</span> (허용 <span className="num">{v.contract.laytimeH}h</span>)</>],
                ['체선', <b className={d.cents > 0 ? 'c-red' : 'c-green'}>{fmtDur(d.excessMin)} · <span className="num">{money(d.cents)}</span></b>],
              ]} />
            </Panel>
            <Panel code="TIME-FLOW" title="시간 흐름" pad>
              <div className="vessel-drawer-flow" role="img" aria-label={`도착 ${fmt(v.eta)}, 접안 ${fmt(d.etb)}, 정박개시 ${fmt(d.ltStart)}, 작업 종료 ${fmt(d.etu)}, 체선 ${fmtDur(d.excessMin)}`}>
                <div className="vessel-drawer-axis" />
                {v.eta < d.etb && <div className="vessel-drawer-segment wait" style={{ left: X(v.eta), width: W(v.eta, d.etb) }} />}
                <div className="vessel-drawer-segment work" style={{ left: X(d.etb), width: W(d.etb, d.etu) }} />
                <div className="vessel-drawer-segment lay" style={{ left: X(d.ltStart), width: W(d.ltStart, Math.min(allowEnd, d.etu)) }} />
                {d.excessMin > 0 && <div className="vessel-drawer-segment dem" style={{ left: X(allowEnd), width: W(allowEnd, d.etu) }} />}
                <span className="vessel-drawer-tick" style={{ left: X(v.eta) }}>ETA <span className="num">{fmt(v.eta).slice(6)}</span></span>
                <span className="vessel-drawer-tick end" style={{ left: X(d.etu) }}>작업 종료 <span className="num">{fmt(d.etu).slice(6)}</span></span>
                <span className="vessel-drawer-tick bottom" style={{ left: X(d.ltStart) }}>정박개시</span>
              </div>
              <p className="vessel-drawer-legend"><span>점선 대기</span> · <span className="c-blue">파랑 작업</span> · <span className="c-green">초록 허용 정박시간</span> · <span className="c-red">빨강 체선</span></p>
            </Panel>
            <Panel code="CALC-STEPS" title="산출 순서" desc="규칙 ID = 규칙 표 번호">
              <ol className="vessel-drawer-calc">
                {steps.map((s, i) => <li key={s.k} className={s.strong ? 'total' : ''}>
                  <div className="vessel-drawer-step-head"><span className="vessel-drawer-step-no num">{i + 1}</span><b>{s.k}</b><span className="chip">{s.rule}</span><strong className={`${s.numeric ? 'num' : ''} ${s.strong ? d.cents > 0 ? 'c-red' : 'c-green' : ''}`}>{s.val}</strong></div>
                  <p>{s.f}</p>
                </li>)}
              </ol>
              <div className="vessel-drawer-formula">
                <p>체선료 = 체선 시간 {fmtDur(d.excessMin)} × 일 체선료 {rate(d.rateCents)} ÷ 24</p>
                <b className={`num ${d.cents > 0 ? 'c-red' : 'c-green'}`}>= {money(d.cents)}</b>
                <p className="muted small">(선박별 센트 단위 한 번 반올림 · <span className="mono">HALF_UP</span>)</p>
              </div>
            </Panel>
            <Panel code="ETB-RULES" title="접안 시각 결정" pad>
              <ul className="vessel-drawer-why">
                <li>도착(NOR) <b className="num">{fmt(v.eta)}</b>{p.ready !== null && <> · {berth.name} 앞 선박 <b>{p.prev}</b> 작업 종료 + 전환 2시간 = <b className="num">{fmt(p.ready)}</b></>} → 둘 중 늦은 <b className="num">{fmt(p.from)}</b>부터 접안 가능 여부 판정</li>
                {p.blockers.map((b) => <li key={`${b.rule}-${b.from}`}><span className="num">{fmt(b.from)} ~ {fmt(b.to)}</span> 접안 불가 · {RULES[b.rule].label} <span className="chip">{b.rule}</span></li>)}
                {!p.blockers.length && <li>추가 제약 없음 · 즉시 접안</li>}
              </ul>
            </Panel>
            {sim.id !== 'FCFS' && <Panel code="FCFS-COMP" title="도착순 기준안 대비">
              <Details rows={[
                ['기준안', <>{berthName(base.bid)} · ETB <span className="num">{fmt(base.etb)}</span> → ETU <span className="num">{fmt(base.etu)}</span><br /><span className="num">{money(base.dem.cents)}</span></>],
                ['접안 시각 차이', <span className={etbDiff > 0 ? 'c-amber' : etbDiff < 0 ? 'c-green' : 'muted'}>{etbDiff === 0 ? '도착순 기준안과 같음' : `도착순 기준안보다 ${fmtDur(Math.abs(etbDiff))} ${etbDiff > 0 ? '늦게 접안' : '일찍 접안'}`}</span>],
                ['체선료 차이', <span className={feeDiff > 0 ? 'c-red' : feeDiff < 0 ? 'c-green' : 'muted'}>{feeDiff === 0 ? '도착순 기준안과 같음' : <><span className="num">{money(Math.abs(feeDiff))}</span> {feeDiff > 0 ? '증가' : '절감'}</>}</span>],
                ['앞 선박 · 대기', <>기준안: {base.ready === null ? '앞 선박 없음' : base.prev} · {fmtDur(base.waitMin)}<br />선택안: {p.ready === null ? '앞 선박 없음' : p.prev} · {fmtDur(p.waitMin)}</>],
                ['차이의 근거', <>{base.bid === p.bid ? `${berth.name}의 앞 선박과 접안 제약을 적용한 결과입니다.` : `${berthName(base.bid)}에서 ${berth.name}로 부두 배정을 변경한 결과입니다.`} {p.ready !== null && p.ready > v.eta && <>앞 선박 {p.prev}의 작업 종료 후 부두 전환 2시간을 기다립니다. </>}{p.blockers.length > 0 ? `${[...new Set(p.blockers.map((b) => RULES[b.rule].label))].join(' · ')} 제약을 적용합니다.` : '기상·주간·조석에 따른 추가 접안 제약은 없습니다.'}</>],
              ]} />
            </Panel>}
            <Panel code="CONTRACT" title="적용 계약 · 규칙">
              <Details rows={[
                ['Laytime', <><span className="num">{v.contract.laytimeH}h</span> <span className="muted">(계약 <span className="mono">{v.contract.id}</span>)</span></>],
                ['정박시간 개시', v.contract.norTurnH ? `NOR 후 ${v.contract.norTurnH}시간 또는 접안 중 빠른 때` : 'NOR 즉시'],
                ['기상 조항', d.clause.label],
                ['작업 시간', <><span className="num">{v.ton.toLocaleString()}</span>톤 ÷ <span className="num">{v.pump.toLocaleString()}</span>톤/시간 + 부대작업 2시간 = {fmtDur(v.workMin)}</>],
                ['계산 기준', '규칙 엔진 · LLM 사용 안 함'],
              ]} />
            </Panel>
          </>}
        </div>
        <footer className="vessel-drawer-footer">출처: 시나리오 입력 · 계약 정보 · 규칙 엔진 계산 — 선박명·제원·계약값은 가상입니다.</footer>
      </section>
    </Drawer>
  )
}
