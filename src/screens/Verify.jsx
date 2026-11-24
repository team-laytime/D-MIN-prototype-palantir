import { useMemo } from 'react'
import { useApp } from '../state/app.jsx'
import { ANSWER_SET } from '../lib/answerSet.js'
import { afterEtb, demurrage, runSearch, validate } from '../lib/engine.js'
import { SCENARIOS, SUN_DAYS } from '../lib/scenarios.js'
import { fmt, fmtDur, money } from '../lib/time.js'
import { Panel, Screen, Stats, St } from '../ui/kit.jsx'
import './decide.css'

const CLAUSE = { FULL: '전부 공제', HALF: '50% 공제', NONE: '공제 없음' }

export default function Verify() {
  const { scenarioId } = useApp()
  const calc = useMemo(() => ANSWER_SET.map((test) => {
    const vessel = {
      eta: test.eta, ton: test.ton, rates: { X: test.rate }, vesselType: test.vesselType,
      contract: { laytimeH: test.laytimeH, rateUsd: test.rateUsd, norTurnH: test.turnH, weather: test.weather, laycan: test.laycan, cfr: test.cfr },
    }
    const work = afterEtb(vessel, 'X', test.etb)
    const dem = demurrage(vessel, test.etb, work.etu, { weather: test.wx, days: SUN_DAYS })
    return { ...test, hoseOff: work.hoseOff, ltStart: dem.ltStart, got: dem.cents, ok: dem.cents === test.expectedCents, excess: dem.excessMin }
  }), [])
  const scenarios = useMemo(() => Object.entries(SCENARIOS).map(([id, make]) => {
    const scenario = make()
    const start = performance.now()
    const result = runSearch(scenario)
    const ms = Math.round(performance.now() - start)
    const best = result.candidates[0]
    const violations = [result.fcfs, ...result.candidates].reduce((n, sim) => n + validate(sim, scenario).length, 0)
    return {
      id, name: scenario.name, vessels: scenario.vessels.length, berths: scenario.berths.length,
      fcfs: result.fcfs.total, best: best.total, saving: result.fcfs.total - best.total,
      violations, ms, explored: result.explored,
    }
  }), [])
  const okCount = calc.filter((row) => row.ok).length
  const violations = scenarios.reduce((n, scenario) => n + scenario.violations, 0)

  return (
    <Screen tab="verify" title="계산 검증" bodyClass="verify-page">
      <p className="verify-intro muted small">팀 최적화 엔진(D-MIN-optimization) 계산값과 자동 계산의 일치 여부, 시나리오별 도착순 기준안 대비 절감액과 제약 위반 수.</p>
      <Stats items={[
        { label: '정답 일치', value: <>{okCount}/{calc.length}<span className="verify-stat-unit">일치</span></>, tone: okCount === calc.length ? 'green' : 'red', sub: '센트 단위 대조 · HALF_UP' },
        { label: '시나리오', value: <>{scenarios.length}<span className="verify-stat-unit">개</span></>, sub: 'S1–S3 · 같은 계산 규칙' },
        { label: '제약 위반', value: <>{violations}<span className="verify-stat-unit">건</span></>, tone: violations ? 'red' : 'green', sub: '탐색과 별도 검사기로 재집계' },
      ]} />

      <Panel
        code="ANSWER-SET" title="체선료 계산 정답 세트" data-tour="answer-set"
        desc="팀 엔진 berth_sim/after_etb로 낸 값(Decimal, HALF_UP)과 이 화면의 자동 계산을 센트 단위로 비교"
        actions={<St tone={okCount === calc.length ? 'ok' : 'bad'}>일치 <span className="num">{okCount} / {calc.length}</span>건</St>}
      >
        <table className="dt verify-answers">
          <thead>
            <tr><th>ID</th><th>사례</th><th>NOR</th><th>접안</th><th>정박개시</th><th>호스분리</th><th className="r">허용</th><th>기상 조항</th><th className="r">초과</th><th className="r">팀 엔진</th><th className="r">자동 계산</th><th className="c">결과</th></tr>
          </thead>
          <tbody>
            {calc.map((row) => (
              <tr key={row.id}>
                <td className="num"><span className="faint">{row.id}</span></td>
                <td className="verify-case">{row.note}</td>
                <td className="verify-time"><span className="num">{fmt(row.eta)}</span>{row.turnH > 0 && <span className="num faint"> +{row.turnH}h</span>}</td>
                <td className="num verify-time">{fmt(row.etb)}</td>
                <td className="num verify-time">{fmt(row.ltStart)}</td>
                <td className="num verify-time">{fmt(row.hoseOff)}</td>
                <td className="num r">{row.laytimeH}h</td>
                <td className="verify-clause">{CLAUSE[row.weather]}</td>
                <td className="r verify-duration">{fmtDur(row.excess)}</td>
                <td className="num r">{money(row.expectedCents)}{row.teamCents !== undefined && <div className="tiny c-amber" title="팀 엔진은 float로 계산한 뒤 반올림해 정확한 반 센트를 내림합니다">엔진 {money(row.teamCents)}</div>}</td>
                <td className="num r">{money(row.got)}</td>
                <td className="c"><St tone={row.ok ? 'ok' : 'bad'}>{row.ok ? '일치' : '불일치'}</St></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel code="SCENARIO-QA" title="시나리오별 제안 효과" desc="도착순 기준안과 최저 후보를 같은 규칙으로 비교">
        <table className="dt verify-scenarios">
          <thead><tr><th>시나리오</th><th className="r">규모</th><th className="r">기준안</th><th className="r">최선 후보</th><th className="r">절감액</th><th className="r">절감률</th><th className="r">제약 위반</th><th className="r">탐색</th></tr></thead>
          <tbody>
            {scenarios.map((scenario) => (
              <tr className={scenario.id === scenarioId ? 'on' : ''} key={scenario.id}>
                <td><span className="num faint">{scenario.id}</span> <span className="strong">{scenario.name}</span></td>
                <td className="r verify-scale"><span className="num">{scenario.berths}</span>부두 · <span className="num">{scenario.vessels}</span>척</td>
                <td className="num r">{money(scenario.fcfs)}</td>
                <td className="num r">{money(scenario.best)}</td>
                <td className="r"><span className="num c-green">{money(scenario.saving)}</span></td>
                <td className="num r">{scenario.fcfs ? ((scenario.saving / scenario.fcfs) * 100).toFixed(1) : '0.0'}%</td>
                <td className="r"><St tone={scenario.violations ? 'bad' : 'ok'}><span className="num">{scenario.violations}</span>건</St></td>
                <td className="r verify-search"><span className="num">{scenario.explored.toLocaleString()}</span>안 · <span className="num">{scenario.ms}ms</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="verify-notes small muted">
          <p>제약 위반은 탐색과 별도 검사기로 재집계합니다. 탐색 시간은 현재 브라우저의 단일 실행 참고값입니다.</p>
          <p>6척은 모든 순서·부두 조합을 전수 계산. 실제 규모(8~16척)는 솔버로 후보를 추린 뒤 같은 검사기로 재검증 필요.</p>
        </div>
      </Panel>
    </Screen>
  )
}
