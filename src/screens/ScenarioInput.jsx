import { useState } from 'react'
import { Button, Callout, HTMLSelect, Icon, InputGroup, NumericInput, Switch } from '@blueprintjs/core'
import { compatibleBerths } from '../lib/engine.js'
import { WEATHER_CLAUSE } from '../lib/scenarios.js'
import { NOW, at, fmt, fmtDur, fromInput, money, toInput } from '../lib/time.js'
import { useApp } from '../state/app.jsx'
import { Panel, Screen, Stats, St } from '../ui/kit.jsx'
import './plan.css'

export default function ScenarioInput() {
  const { scenInput: scen, scen: calc, editScen, version, result, go, scenarioId, setScenarioId } = useApp()
  const [pick, setPick] = useState(scenarioId)
  const params = scen.params
  const weather = scen.env.weather
  const berthById = Object.fromEntries(scen.berths.map((berth) => [berth.id, berth]))
  const errors = []

  for (const vessel of scen.vessels) {
    if (!(vessel.contract.laytimeH > 0)) errors.push(`${vessel.name}: 허용 시간은 0보다 커야 합니다`)
    if (!(vessel.contract.rateUsd > 0)) errors.push(`${vessel.name}: 하루 체선료는 0보다 커야 합니다`)
    if (compatibleBerths(vessel, scen).length === 0) errors.push(`${vessel.name}: 제품·제원에 맞는 부두가 없습니다`)
  }
  if (weather && weather.end <= weather.start) errors.push('기상 악화 종료 시각이 시작 시각보다 빠릅니다')

  const canCompare = errors.length === 0 && !result.error
  const setParam = (field, value) => {
    if (!Number.isFinite(value) || value < 0 || value === params[field]) return
    editScen((draft) => { draft.params[field] = value })
  }
  const setSwitching = (value) => {
    if (!Number.isFinite(value) || value < 0 || value === scen.env.switchingMin) return
    editScen((draft) => { draft.env.switchingMin = value })
  }
  const lock = <Icon icon="lock" size={10} className="faint" />
  const setEta = (index, value) => {
    const time = fromInput(value)
    if (time !== null && time !== scen.vessels[index].eta) {
      editScen((draft) => { draft.vessels[index].eta = time })
    }
  }
  const setWeatherTime = (field, value) => {
    const time = fromInput(value)
    if (time !== null && time !== weather[field]) {
      editScen((draft) => { draft.env.weather[field] = time })
    }
  }
  const toggleWeather = (on) => editScen((draft) => {
    draft.env.weather = on
      ? { start: at(14, 18), end: at(15, 6), label: '강풍 주의보 (최대 풍속 17m/s)', source: '기상청 단기예보 (가상)' }
      : null
  })

  return (
    <Screen
      tab="input"
      title="시나리오 불러오기"
      step={1}
      bodyClass="plan-input plan-stack"
      actions={<Button intent="primary" endIcon="arrow-right" disabled={!canCompare} onClick={() => go('compare')}>후보 비교</Button>}
    >
      {/* 11-23 피드백: 시나리오는 입력하는 게 아니라 DB(2025년 합성 데이터)에서 기준 시점을 골라 불러온다. */}
      <Panel code="LOAD" title="불러오기" pad actions={<span className="plan-version mono">INPUT v{version}</span>}>
        <div className="pi-load">
          <label><span>데이터</span><HTMLSelect size="small" value="db2025" options={[{ value: 'db2025', label: '2025년 1년치 운영 합성 데이터 (DB, 가상)' }]} /></label>
          <label><span>기준 시점</span><HTMLSelect size="small" value={pick} onChange={(e) => setPick(e.target.value)} options={[
            { value: 'S1', label: `2026-11-14 08:00 · 기상 악화 예보일, 6척 집중` },
            { value: 'S2', label: `2026-11-14 08:00 · 평시 (기상 이상 없음)` },
            { value: 'S3', label: `2026-11-14 08:00 · 대형선 지연 + 조석 제약` },
          ]} /></label>
          <Button intent="primary" icon="import" disabled={pick === scenarioId} onClick={() => setScenarioId(pick)}>불러오기</Button>
          <span className="small muted">불러온 시점: <b className="num">2026-{fmt(NOW).replace('/', '-')}</b> · {scen.summary} · 선박 {scen.vessels.length}척, 부두 {scen.berths.length}곳</span>
        </div>
      </Panel>
      <Stats items={[
        { label: '대기 선박', value: <><span>{scen.vessels.length}</span><span className="plan-stat-unit">척</span></>, sub: '도착 예정 · 계약 조건 확인' },
        { label: '부두', value: <><span>{scen.berths.length}</span><span className="plan-stat-unit">곳</span></>, sub: '제품·제원별 접안 가능 부두' },
        { label: '기상 악화', value: <span className="plan-stat-text">{weather ? '예보 있음' : '없음'}</span>, tone: weather ? 'amber' : undefined, sub: weather ? `${fmt(weather.start)} ~ ${fmt(weather.end)}` : '계산 기간 내 예보 없음' },
        { label: '입력 오류', value: <><span>{errors.length}</span><span className="plan-stat-unit">건</span></>, tone: errors.length ? 'red' : 'green', sub: errors.length ? '조건 수정 후 후보를 비교합니다' : '선박·계약 조건 검증 통과' },
      ]} />

      <Panel code="PARAM-IN" title="스케줄러 조절값" desc="스케줄러가 바꿀 수 있는 값만 · 바꾸면 후보를 바로 다시 계산" pad>
        <div className="pi-params">
          <label><span>접안 간격 <i className="req">*</i></span><NumericInput size="small" buttonPosition="none" className="plan-number" value={scen.env.switchingMin} min={0} stepSize={10} onValueChange={setSwitching} /><small>분 · 앞 선박 작업 종료 뒤 다음 접안까지</small></label>
          <label><span>안전재고 <i className="req">*</i></span><NumericInput size="small" buttonPosition="none" className="plan-number" value={params.safetyStockPct} min={0} max={50} onValueChange={(v) => setParam('safetyStockPct', v)} /><small>% · 탱크 여유에서 빼 둘 비율 (나프타 여유 {calc.tanks[0].ullageTon.toLocaleString()}t로 계산)</small></label>
          <label><span>기상 여유 <i className="req">*</i></span><NumericInput size="small" buttonPosition="none" className="plan-number" value={params.weatherMarginH} min={0} max={12} onValueChange={(v) => setParam('weatherMarginH', v)} /><small>시간 · 접안 금지 구간 앞뒤로 더 비움{calc.env.weather ? ` (계산 구간 ${fmt(calc.env.weather.start)}~${fmt(calc.env.weather.end).slice(6)})` : ''}</small></label>
        </div>
      </Panel>

      <Panel
        code="VESSEL-IN"
        title="선박·계약 조건"
        desc="도착 예정만 고칠 수 있음 · 계약 조건은 계약서 값으로 잠금 · * 필수 입력"
        data-tour="inputs"
        actions={<St tone={errors.length ? 'bad' : 'ok'}>{errors.length ? `입력 오류 ${errors.length}건` : '검증 통과'}</St>}
      >
        {errors.length > 0 && (
          <Callout intent="danger" icon="error" title="입력 조건을 확인하십시오" className="plan-errors">
            <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
          </Callout>
        )}
        {result.error && <Callout intent="danger" icon="warning-sign" title="후보 계산 불가" className="plan-errors">{result.error}</Callout>}
        <table className="dt plan-input-table">
          <caption className="plan-sr-only">선박별 제원과 수정 가능한 계약·도착 조건</caption>
          <thead>
            <tr>
              <th>선박</th><th>화물</th><th className="r">DWT</th><th className="r">흘수</th><th className="r">작업 시간</th>
              <th>도착 예정(NOR) <i className="req">*</i></th><th className="r">{lock} 허용(h)</th><th className="r">{lock} 일 체선료($)</th>
              <th className="r">{lock} 개시(h)</th><th>{lock} 기상 조항</th><th>가능 부두</th>
            </tr>
          </thead>
          <tbody>
            {scen.vessels.map((vessel, index) => (
              <tr key={vessel.id}>
                <td>
                  <span className="plan-vessel-name mono">{vessel.name}</span>
                  <div className="faint tiny mono">{vessel.contract.id}</div>
                </td>
                <td className="plan-nowrap">
                  {vessel.product} <span className="muted">{vessel.dir}</span>
                  <div className="faint tiny"><span className="num">{vessel.ton.toLocaleString()}</span>톤</div>
                </td>
                <td className="num r">{vessel.dwt.toLocaleString()}</td>
                <td className="num r">{vessel.draft}m</td>
                <td className="r plan-nowrap">{fmtDur(vessel.workMin)}</td>
                <td>
                  <InputGroup
                    type="datetime-local"
                    size="small"
                    className="plan-datetime"
                    aria-label={`${vessel.name} 도착 예정(NOR)`}
                    value={toInput(vessel.eta)}
                    onChange={(event) => setEta(index, event.target.value)}
                  />
                </td>
                <td className="num r pi-locked">{vessel.contract.laytimeH}</td>
                <td className="num r pi-locked">{vessel.contract.rateUsd.toLocaleString()}</td>
                <td className="num r pi-locked">{vessel.contract.norTurnH}</td>
                <td className="pi-locked small">{WEATHER_CLAUSE[vessel.contract.weather].label}</td>
                <td>
                  <div className="plan-berth-chips">
                    {compatibleBerths(vessel, scen).map((id) => <span className="chip" key={id}>{berthById[id].name.replace(' 부두', '')}</span>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="plan-input-bottom">
        <Panel code="BERTH-IN" title="부두" desc="접안 제원·현재 접안·설비 점검">
          <table className="dt plan-berth-table">
            <thead>
              <tr><th>부두</th><th className="r">최대 DWT</th><th className="r">최대 흘수</th><th>접안 가능 제품</th><th>현재 접안</th><th>설비 점검</th></tr>
            </thead>
            <tbody>
              {scen.berths.map((berth) => (
                <tr key={berth.id}>
                  <td className="plan-nowrap"><strong>{berth.name}</strong>{berth.tideLimited && <div className="c-blue tiny">조석 제한</div>}</td>
                  <td className="num r">{berth.maxDwt.toLocaleString()}</td>
                  <td className="num r">{berth.maxDraft}m</td>
                  <td className="small muted">{berth.products.join(', ')}</td>
                  <td>
                    {berth.occupiedBy
                      ? <><span className="mono tiny">{berth.occupiedBy}</span><div className="num faint tiny">~ {fmt(berth.occupiedUntil)}</div></>
                      : <span className="faint small">비어 있음</span>}
                  </td>
                  <td>
                    {berth.facility.maintenance
                      ? <><span className="small">{berth.facility.maintenance.label}</span><div className="num faint tiny">{fmt(berth.facility.maintenance.start)} ~ {fmt(berth.facility.maintenance.end).slice(6)}</div></>
                      : !berth.facility.known
                        ? <St tone="unknown">미입력</St>
                        : <span className="faint small">없음</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel code="ENV-IN" title="기상·조석·일출몰" desc="공공데이터포털 형식 · 가상 값" data-tour="env" pad>
          <div className="plan-weather-switch">
            <Switch checked={!!weather} onChange={(event) => toggleWeather(event.target.checked)} label="기상 악화 예보" />
            <St tone={weather ? 'warn' : 'ok'}>{weather ? '구간 내 전 부두 접안 금지' : '기상 악화 없음'}</St>
          </div>
          {weather && (
            <div className="plan-weather">
              <div className="plan-weather-times">
                <label>시작<InputGroup type="datetime-local" size="small" aria-label="기상 악화 시작" value={toInput(weather.start)} onChange={(event) => setWeatherTime('start', event.target.value)} /></label>
                <label>종료<InputGroup type="datetime-local" size="small" aria-label="기상 악화 종료" intent={weather.end <= weather.start ? 'danger' : undefined} value={toInput(weather.end)} onChange={(event) => setWeatherTime('end', event.target.value)} /></label>
              </div>
              <p className="tiny muted">{weather.label} · {weather.source}</p>
            </div>
          )}
          <dl className="plan-env-list small">
            <dt>만조</dt>
            <dd className="plan-time-list">{scen.env.highTides.slice(0, 6).map((time) => <span className="num" key={time}>{fmt(time)}</span>)}</dd>
            <dt>일출 / 일몰</dt>
            <dd className="plan-time-list">{scen.env.days.slice(1, 4).map((day) => <span className="num" key={day.day}>{fmt(day.sunrise)} / {fmt(day.sunset).slice(6)}</span>)}</dd>
            <dt>접안 규칙</dt>
            <dd>
              부두 전환 <span className="num">{scen.env.switchingMin / 60}</span>시간 · DWT <span className="num">{(scen.env.daylightDwt / 10000).toFixed(0)}</span>만 톤 이상은 주간(일몰 1시간 전까지)만 접안 ·
              SK 6부두 흘수 <span className="num">{scen.env.tideDraft}</span>m 이상은 만조 ±<span className="num">{scen.env.tideWindowMin / 60}</span>시간
            </dd>
            <dt>탱크</dt>
            <dd>{scen.tanks.map((tank) => <span key={tank.product}>{tank.product} 여유 <span className="num">{tank.ullageTon.toLocaleString()}</span>톤 </span>)}</dd>
            <dt>긴급 출하</dt>
            <dd>{scen.urgent.map((urgent) => <span key={urgent.vid}><span className="mono">{scen.vessels.find((vessel) => vessel.id === urgent.vid).name}</span> <span className="num">{fmt(urgent.deadline)}</span>까지 </span>)}</dd>
          </dl>
        </Panel>
      </div>

      {canCompare && (
        <div className="plan-input-summary">
          <St tone="live">현재 입력 기준</St>
          <span>도착순 <span className="num">{money(result.fcfs.total)}</span></span>
          <span className="muted">→</span>
          <span>최저 후보 <span className="num c-green">{money(result.candidates[0]?.total ?? result.fcfs.total)}</span></span>
          <span className="faint">수정한 조건은 후보 비교에 즉시 반영됩니다.</span>
        </div>
      )}
    </Screen>
  )
}
