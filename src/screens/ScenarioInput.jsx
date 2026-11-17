import { Button, Callout, HTMLSelect, InputGroup, NumericInput, Switch } from '@blueprintjs/core'
import { compatibleBerths } from '../lib/engine.js'
import { WEATHER_CLAUSE } from '../lib/scenarios.js'
import { at, fmt, fmtDur, fromInput, money, toInput } from '../lib/time.js'
import { useApp } from '../state/app.jsx'
import { Panel, Screen, Stats, St } from '../ui/kit.jsx'
import './plan.css'

export default function ScenarioInput() {
  const { scen, editScen, version, result, go } = useApp()
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
  const setContract = (index, field, value) => {
    if (!Number.isFinite(value) || value === scen.vessels[index].contract[field]) return
    editScen((draft) => { draft.vessels[index].contract[field] = value })
  }
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
      title="시나리오 입력"
      step={1}
      bodyClass="plan-input plan-stack"
      actions={<Button intent="primary" endIcon="arrow-right" disabled={!canCompare} onClick={() => go('compare')}>후보 비교</Button>}
    >
      <div className="plan-intro">
        <p>{scen.summary}. 수정 즉시 전체 화면을 재계산합니다.</p>
        <span className="plan-version mono">INPUT v{version}</span>
      </div>
      <Stats items={[
        { label: '대기 선박', value: <><span>{scen.vessels.length}</span><span className="plan-stat-unit">척</span></>, sub: '도착 예정 · 계약 조건 확인' },
        { label: '부두', value: <><span>{scen.berths.length}</span><span className="plan-stat-unit">곳</span></>, sub: '제품·제원별 접안 가능 부두' },
        { label: '기상 악화', value: <span className="plan-stat-text">{weather ? '예보 있음' : '없음'}</span>, tone: weather ? 'amber' : undefined, sub: weather ? `${fmt(weather.start)} ~ ${fmt(weather.end)}` : '계산 기간 내 예보 없음' },
        { label: '입력 오류', value: <><span>{errors.length}</span><span className="plan-stat-unit">건</span></>, tone: errors.length ? 'red' : 'green', sub: errors.length ? '조건 수정 후 후보를 비교합니다' : '선박·계약 조건 검증 통과' },
      ]} />

      <Panel
        code="VESSEL-IN"
        title="선박·계약 조건"
        desc="도착 예정·허용 시간·체선료·기상 조항을 수정합니다"
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
              <th>도착 예정(NOR)</th><th className="r">허용(h)</th><th className="r">일 체선료($)</th>
              <th className="r">개시(h)</th><th>기상 조항</th><th>가능 부두</th>
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
                <td>
                  <NumericInput
                    size="small"
                    buttonPosition="none"
                    className="plan-number plan-hours"
                    aria-label={`${vessel.name} 허용 시간(h)`}
                    value={vessel.contract.laytimeH}
                    min={0}
                    intent={vessel.contract.laytimeH > 0 ? undefined : 'danger'}
                    onValueChange={(value) => setContract(index, 'laytimeH', value)}
                  />
                </td>
                <td>
                  <NumericInput
                    size="small"
                    buttonPosition="none"
                    className="plan-number plan-rate"
                    aria-label={`${vessel.name} 일 체선료($)`}
                    value={vessel.contract.rateUsd}
                    min={0}
                    stepSize={500}
                    majorStepSize={5000}
                    intent={vessel.contract.rateUsd > 0 ? undefined : 'danger'}
                    onValueChange={(value) => setContract(index, 'rateUsd', value)}
                  />
                </td>
                <td>
                  <NumericInput
                    size="small"
                    buttonPosition="none"
                    className="plan-number plan-hours"
                    aria-label={`${vessel.name} 개시 시간(h)`}
                    value={vessel.contract.norTurnH}
                    min={0}
                    onValueChange={(value) => setContract(index, 'norTurnH', value)}
                  />
                </td>
                <td>
                  <HTMLSelect
                    size="small"
                    className="plan-clause"
                    aria-label={`${vessel.name} 기상 조항`}
                    value={vessel.contract.weather}
                    options={Object.entries(WEATHER_CLAUSE).map(([value, clause]) => ({ value, label: clause.label }))}
                    onChange={(event) => {
                      const value = event.target.value
                      editScen((draft) => { draft.vessels[index].contract.weather = value })
                    }}
                  />
                </td>
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
