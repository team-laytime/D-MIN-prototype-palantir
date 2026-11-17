import { useMemo } from 'react'
import { Button, Callout } from '@blueprintjs/core'
import { risks, validate } from '../lib/engine.js'
import { at, fmt, fmtDur, money } from '../lib/time.js'
import { useApp } from '../state/app.jsx'
import { Panel, Screen, Stats, St } from '../ui/kit.jsx'
import Timeline from './Timeline.jsx'
import './plan.css'

export default function Compare() {
  const { scen, result, all, focusId, setFocusId, openVessel, go, version } = useApp()
  const summaries = useMemo(() => all.map((sim) => {
    const remaining = risks(sim, scen)
    return {
      sim,
      delta: sim.total - result.fcfs.total,
      hit: remaining.filter((risk) => risk.state === '해당').length,
      unknown: remaining.filter((risk) => risk.state === '판단 불가').length,
      violations: validate(sim, scen).length,
    }
  }), [all, scen, result])
  const range = useMemo(() => ({
    start: at(14, 0),
    end: Math.ceil((Math.max(at(15, 0), ...all.flatMap((sim) => sim.placements.map((placement) => placement.etu))) + 60) / 360) * 360,
  }), [all])

  if (result.error) {
    return <Screen tab="compare" title="후보 비교" step={2}><Callout intent="danger" title="후보 계산 불가">{result.error}</Callout></Screen>
  }

  const focus = all.find((sim) => sim.id === focusId) ?? result.candidates[0] ?? result.fcfs
  const best = result.candidates[0] ?? result.fcfs
  const savings = result.fcfs.total - best.total
  const pctOf = (delta) => result.fcfs.total ? Math.round(delta / result.fcfs.total * 1000) / 10 : 0
  const vesselById = Object.fromEntries(scen.vessels.map((vessel) => [vessel.id, vessel]))
  const berthById = Object.fromEntries(scen.berths.map((berth) => [berth.id, berth]))
  const baselineById = Object.fromEntries(result.fcfs.placements.map((placement) => [placement.vid, placement]))
  const rows = [...focus.placements].sort((a, b) => vesselById[a.vid].eta - vesselById[b.vid].eta)
  const openEvidence = (simId, vid) => openVessel(simId, vid, { mode: 'evidence' })

  return (
    <Screen
      tab="compare"
      title="후보 비교"
      step={2}
      bodyClass="plan-compare plan-stack"
      actions={<Button intent="primary" endIcon="arrow-right" onClick={() => go('risk')}>리스크 확인</Button>}
    >
      <div className="plan-intro">
        <p>순서·부두 조합 <span className="num">{result.explored.toLocaleString()}</span>개를 같은 규칙으로 계산, 제약을 지키는 배치 중 체선료 하위 <span className="num">{result.candidates.length}</span>개</p>
        <span className="plan-version mono">INPUT v{version}</span>
      </div>
      <Stats items={[
        { label: '도착순 기준안', value: money(result.fcfs.total).replace(/\.\d+$/, ''), sub: '비교용 · 현행 실적 아님' },
        { label: `${best.label} (최저)`, value: money(best.total).replace(/\.\d+$/, ''), sub: '동일 입력·동일 제약 기준', tone: 'green' },
        { label: '줄어드는 비율', value: `${pctOf(savings)}%`, sub: `기준안 대비 ${money(savings)} 절감`, tone: 'green' },
        { label: '돌려 본 조합', value: result.explored.toLocaleString(), sub: `서로 다른 배치 ${result.distinct.toLocaleString()}개` },
      ]} />

      <Panel
        code="CAND-COST"
        title="기준안과 후보"
        desc="안을 선택하면 아래 선박별 결과가 바뀝니다"
        data-tour="cards"
        actions={<><St tone="unknown">결과 신뢰: 가정값 포함</St><span className="plan-confidence">최선 탐색 결과 (최적 증명 아님)</span></>}
      >
        <table className="dt plan-candidate-table">
          <caption className="plan-sr-only">도착순 기준안과 후보별 총 예상 체선료·변경·제약·리스크 비교</caption>
          <thead>
            <tr><th>안</th><th className="r">총 예상 체선료</th><th className="r">기준안 대비</th><th className="r">변경 선박</th><th className="r">제약 위반</th><th>리스크</th><th>비고</th></tr>
          </thead>
          <tbody>
            {summaries.map(({ sim, delta, hit, unknown, violations }) => (
              <tr
                key={sim.id}
                className={`click ${sim.id === focus.id ? 'on' : ''}`}
                data-candidate={sim.id}
                onClick={() => setFocusId(sim.id)}
              >
                <td>
                  <button className="plan-candidate-select" aria-pressed={sim.id === focus.id} onClick={() => setFocusId(sim.id)}>
                    <span className="plan-radio" aria-hidden="true" />
                    <span className="strong">{sim.label}</span>
                    <span className="plan-candidate-code mono">{sim.id}</span>
                  </button>
                </td>
                <td className="r num strong">{money(sim.total)}</td>
                <td className={`r num ${delta < 0 ? 'c-green' : delta > 0 ? 'c-red' : ''}`}>{sim.id === 'FCFS' ? '—' : `${money(delta)} (${pctOf(delta)}%)`}</td>
                <td className="r"><span className="num">{sim.changed.length}</span><span className="muted">척</span></td>
                <td className={`r num ${violations ? 'c-red' : 'muted'}`}>{violations}</td>
                <td>
                  <div className="plan-risk-counts">
                    <St tone={hit ? 'warn' : 'ok'}>해당 <span className="num">{hit}</span></St>
                    {unknown > 0 && <St tone="unknown">판단 불가 <span className="num">{unknown}</span></St>}
                  </div>
                </td>
                <td className="small muted">{sim.id === 'FCFS' ? '비교용 · 현행 실적 아님' : sim.id === 'A' ? <span className="c-green">체선료 최저</span> : '순서·부두 대안'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        code="BERTH-TL"
        title="부두별 타임라인"
        desc="동일 시간축 · 선박 막대를 누르면 산출 근거 표시"
        actions={<span className="num faint tiny">{fmt(range.start)} — {fmt(range.end)}</span>}
      >
        <div className="plan-timeline-legend">
          <span><i className="plan-key plan-key-work" />작업</span>
          <span><i className="plan-key plan-key-dem" />체선 발생</span>
          <span><i className="plan-key plan-key-changed" />기준안과 달라진 선박</span>
          <span><i className="plan-key plan-key-wait" />도착 후 대기</span>
          <span><i className="plan-key plan-key-night" />야간</span>
          <span title={scen.env.weather?.label}><i className="plan-key plan-key-weather" />{scen.env.weather ? scen.env.weather.label : '기상 악화 없음'}</span>
          <span><i className="plan-key plan-key-maint" />설비 점검</span>
          <span><i className="plan-key plan-key-tide" />만조(SK 6부두)</span>
        </div>
        <div className="plan-timelines">
          {all.map((sim, index) => (
            <div
              key={sim.id}
              className={`plan-timeline-row ${sim.id === focus.id ? 'plan-selected' : ''}`}
              data-tour={sim.id === focus.id ? 'tl-row-on' : undefined}
              data-timeline={sim.id}
            >
              <button className="plan-timeline-select" onClick={() => setFocusId(sim.id)} aria-pressed={sim.id === focus.id}>
                <span className="plan-timeline-code mono">{sim.id}</span>
                <strong>{sim.label}</strong>
                <span className="num">{money(sim.total)}</span>
              </button>
              <Timeline sim={sim} scen={scen} range={range} changed={sim.changed} axis={index === 0} compact onPick={(vid) => openEvidence(sim.id, vid)} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        code="VESSEL-OUT"
        title={`${focus.label} 선박별 결과`}
        desc="도착(NOR) 순 · 기준안 대비 변경 선박과 체선료 확인"
        actions={<Button size="small" intent="primary" endIcon="arrow-right" onClick={() => go('risk')}>리스크 확인</Button>}
      >
        <table className="dt plan-result-table" data-focused-plan={focus.id}>
          <caption className="plan-sr-only">{focus.label} 선박별 접안·대기·작업 종료·체선료 결과</caption>
          <thead>
            <tr><th>선박</th><th>제품</th><th>부두</th><th>도착(NOR)</th><th>접안(ETB)</th><th className="r">대기</th><th>작업 종료</th><th className="r">예상 체선료</th><th className="r">기준안 대비</th><th>상세</th></tr>
          </thead>
          <tbody>
            {rows.map((placement) => {
              const vessel = vesselById[placement.vid]
              const delta = placement.dem.cents - baselineById[placement.vid].dem.cents
              const changed = focus.changed.includes(placement.vid)
              return (
                <tr key={placement.vid} className="click" onClick={() => openVessel(focus.id, placement.vid, { mode: 'card' })}>
                  <td><span className="plan-vessel-name mono">{vessel.name}</span>{changed && <span className="plan-changed-label">변경</span>}</td>
                  <td className="plan-nowrap">{vessel.product} <span className="muted">{vessel.dir}</span></td>
                  <td className="plan-nowrap">{berthById[placement.bid].name}</td>
                  <td className="num">{fmt(vessel.eta)}</td>
                  <td className={`num ${changed ? 'c-blue' : ''}`}>{fmt(placement.etb)}</td>
                  <td className={`r plan-nowrap ${placement.waitMin ? 'c-amber' : 'muted'}`}>{fmtDur(placement.waitMin)}</td>
                  <td className="num">{fmt(placement.etu)}</td>
                  <td className={`num r ${placement.dem.cents > 0 ? 'c-red' : ''}`}>{money(placement.dem.cents)}</td>
                  <td className={`num r ${delta < 0 ? 'c-green' : delta > 0 ? 'c-red' : 'faint'}`}>{delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${money(delta)}`}</td>
                  <td>
                    <div className="plan-vessel-actions" onClick={(event) => event.stopPropagation()}>
                      <Button size="small" variant="minimal" icon="id-number" aria-label={`${vessel.name} 선박 카드`} title="선박 카드" onClick={() => openVessel(focus.id, placement.vid, { mode: 'card' })} />
                      <Button size="small" variant="minimal" icon="document" aria-label={`${vessel.name} 산출 근거`} title="산출 근거" onClick={() => openEvidence(focus.id, placement.vid)} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={7}>총 예상 체선료 <span className="muted small">· USD</span></td><td className={`num r strong ${focus.total > 0 ? 'c-red' : ''}`}>{money(focus.total)}</td><td className={`num r ${focus.total < result.fcfs.total ? 'c-green' : 'faint'}`}>{focus.total === result.fcfs.total ? '—' : money(focus.total - result.fcfs.total)}</td><td /></tr>
          </tfoot>
        </table>
      </Panel>
      <p className="plan-footnote">선박 행 또는 선박 카드 버튼으로 상세를 열고, 문서 버튼으로 산출 근거를 확인합니다. 결과는 가상 입력과 계약 가정을 포함합니다.</p>
    </Screen>
  )
}
