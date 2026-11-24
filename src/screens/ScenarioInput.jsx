// 계획 조건 (11-24 실데이터): 데이터 팀 묶음의 선박, 부두, 기상을 보여 주고 스케줄러가 고칠 수 있는 값만 연다.
//  - 고칠 수 있는 값: 선박 ETA, 부두 사용 불가 구간(blocks), 엔진 조절값(params)
//  - 계약 값(허용 시간, 일 체선료)은 잠금. 체선료는 화면에서 계산하지 않고 「다시 계산」으로 팀 엔진에 보낸다.
import { useMemo, useState } from 'react'
import { Button, Callout, HTMLSelect, Icon, InputGroup, NonIdealState, NumericInput, Spinner } from '@blueprintjs/core'
import { BLOCK_KINDS, PARAM_FIELDS, getIn } from '../lib/scenDiff.js'
import { fmt, fmtFull, fromInput, money, toInput } from '../lib/time.js'
import { useApp } from '../state/app.jsx'
import { Panel, Screen } from '../ui/kit.jsx'
import './plan.css'

const WIND_LIMIT = 14 // m/s, 3~8부두와 부이의 하역 중단 기준(팀 엔진 weather.py). 1~2부두와 가스부두는 18
const berthsText = (b, byId) => (b.berths ? b.berths.map((id) => byId[id]?.code ?? id).join(', ') : '전 부두')

export default function ScenarioInput() {
  const { scenInput: scen, editScen, version, result, recalc, go } = useApp()
  const [query, setQuery] = useState('')
  const [etaDesc, setEtaDesc] = useState(false)

  const berthById = useMemo(() => Object.fromEntries((scen?.berths ?? []).map((b) => [b.id, b])), [scen?.berths])
  const vessels = useMemo(() => {
    if (!scen) return []
    const q = query.trim().toLowerCase()
    const list = q
      ? scen.vessels.filter((v) => [v.callSign, v.name, v.cargo, v.product, v.cls, v.dir].some((s) => String(s ?? '').toLowerCase().includes(q)))
      : [...scen.vessels]
    return list.sort((a, b) => ((a.eta ?? Infinity) - (b.eta ?? Infinity)) * (etaDesc ? -1 : 1))
  }, [scen, query, etaDesc])

  if (!scen) {
    return (
      <Screen tab="input" title="계획 조건" step={1} bodyClass="plan-input plan-stack">
        {result.error && !result.loading
          ? <Callout intent="danger" icon="error" title="데이터셋을 불러오지 못했습니다">{result.error}</Callout>
          : <NonIdealState icon={<Spinner size={24} />} title="데이터셋을 불러오는 중입니다" />}
      </Screen>
    )
  }

  // ── 검증 ─────────────────────────────────────────────────────────
  const errors = []
  for (const v of scen.vessels) {
    if (v.eta == null) errors.push(`${v.name}: ETA가 비어 있습니다`)
    if (!v.compat.length) errors.push(`${v.name}: 갈 수 있는 부두가 없습니다`)
  }
  scen.blocks.forEach((b, i) => {
    if (!(b.end > b.start)) errors.push(`사용 불가 ${i + 1}번(${berthsText(b, berthById)}): 종료가 시작보다 늦어야 합니다`)
  })
  const pv = (f) => getIn(scen.params, f.path) ?? f.def
  if (pv(PARAM_FIELDS[0]) >= pv(PARAM_FIELDS[1])) errors.push('안전재고 하한이 상한보다 작아야 합니다')

  // ── 편집 ─────────────────────────────────────────────────────────
  const setEta = (vid, value) => {
    const t = fromInput(value)
    const cur = scen.vessels.find((v) => v.id === vid)
    if (t === null || t === cur.eta) return
    editScen((d) => { d.vessels.find((v) => v.id === vid).eta = t })
  }
  const setParam = (f, value) => {
    if (!Number.isFinite(value) || value < f.min || value > f.max || value === getIn(scen.params, f.path)) return
    editScen((d) => { const [g, k] = f.path; (d.params[g] ??= {})[k] = value })
  }
  const resetParam = (f) => editScen((d) => {
    const [g, k] = f.path
    if (!d.params[g]) return
    delete d.params[g][k]
    if (!Object.keys(d.params[g]).length) delete d.params[g]
  })
  const addBlock = () => editScen((d) => {
    const start = Math.max(0, d.window.start)
    d.blocks.push({ id: `blk-${Date.now()}`, berths: [d.berths[0].id], start, end: start + 6 * 60, kind: 'CONSTRUCTION', source: '스케줄러 입력' })
  })
  const editBlock = (i, fn) => editScen((d) => fn(d.blocks[i]))
  const removeBlock = (i) => editScen((d) => { d.blocks.splice(i, 1) })
  const setBlockTime = (i, field, value) => {
    const t = fromInput(value)
    if (t !== null && t !== scen.blocks[i][field]) editBlock(i, (b) => { b[field] = t })
  }

  // 돌발 상황(메일)에서 들어온 구간
  const incBlocks = scen.blocks.filter((b) => b.incId)
  const blocksOf = (bid) => scen.blocks.filter((b) => !b.berths || b.berths.includes(bid))

  // 부두를 부두(pier)별로 묶는다
  const piers = []
  for (const b of scen.berths) {
    const g = piers.at(-1)
    if (g && g.pier === b.pier) g.list.push(b)
    else piers.push({ pier: b.pier, name: b.pierName, list: [b] })
  }

  // 기상: 계획 기간 안 관측(부이) 풍속
  const wind = scen.wind.filter((w) => w.t >= scen.window.start && w.t <= scen.window.end)
  const maxWind = wind.reduce((m, w) => (w.ms > (m?.ms ?? -1) ? w : m), null)

  const canRecalc = result.stale && !result.running && errors.length === 0
  const lock = <Icon icon="lock" size={10} className="faint" />
  const best = result.candidates[0]
  const calcState = result.running ? 'run' : result.calcError ? 'bad' : result.stale ? 'warn' : 'ok'

  return (
    <Screen
      tab="input"
      title="계획 조건"
      step={1}
      bodyClass="plan-input plan-stack"
      actions={<>
        <Button intent={result.stale ? 'warning' : 'none'} icon={result.running ? <Spinner size={14} /> : 'refresh'} disabled={!canRecalc} onClick={() => recalc()}>
          {result.running ? '엔진 계산 중, 약 1분' : '다시 계산'}
        </Button>
        <Button intent="primary" endIcon="arrow-right" disabled={!result.candidates.length} onClick={() => go('compare')}>후보 비교</Button>
      </>}
    >
      <div className="pi-source">
        <Icon icon="database" size={14} />
        <span>{scen.summary}</span>
        <span className="muted small">묶음 <span className="mono">{scen.bundle}</span>, 기준 시각 <b className="num">{fmtFull(0)}</b>, 선박 {scen.vessels.length}척, 부두 {scen.berths.length}곳</span>
        <span className="plan-version mono">INPUT v{version}</span>
      </div>

      <div className={`pi-calc ${calcState}`} data-tour="recalc">
        {calcState === 'run' ? <><Spinner size={14} /><b>엔진 계산 중, 약 1분</b><span className="muted">후보 {scen.presets.length}개를 팀 엔진(CP-SAT)으로 동시에 계산합니다.</span></>
          : calcState === 'bad' ? <><Icon icon="error" size={14} /><b>다시 계산하지 못했습니다</b><span>{result.calcError}</span></>
            : calcState === 'warn' ? <><Icon icon="warning-sign" size={14} /><b>계획 조건이 바뀌었습니다</b><span>지금 후보는 바뀌기 전 조건으로 계산한 것입니다. 「다시 계산」을 눌러야 반영됩니다.</span></>
              : <><Icon icon="tick-circle" size={14} /><b>후보가 지금 조건으로 계산되어 있습니다</b><span className="muted">계산 시각 {result.calcAt ?? '-'}{best ? `, 최저 후보 ${best.label} ${money(best.total)}` : ''}</span></>}
        {(calcState === 'warn' || calcState === 'bad') && (
          <Button size="small" intent="warning" icon="refresh" disabled={!canRecalc} onClick={() => recalc()}>다시 계산</Button>
        )}
      </div>

      {incBlocks.length > 0 && (
        <div className="pi-inc-strip">
          <Icon icon="warning-sign" size={14} />
          <b>돌발 상황 {new Set(incBlocks.map((b) => b.incId)).size}건이 부두 사용 불가로 들어와 있음</b>
          <span>{incBlocks.map((b) => `${berthsText(b, berthById)} ${fmt(b.start)}~${fmt(b.end)} ${BLOCK_KINDS[b.kind] ?? b.kind}`).join(', ')}</span>
          <span className="muted small">아래 「부두 사용 불가」에서 고칠 수 있습니다.</span>
          <Button size="small" variant="minimal" icon="inbox" onClick={() => go('inbox')}>메일 보기</Button>
        </div>
      )}

      {errors.length > 0 && (
        <Callout intent="danger" icon="error" title={`입력 오류 ${errors.length}건, 고쳐야 다시 계산할 수 있습니다`} className="plan-errors">
          <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Callout>
      )}

      <Panel code="PARAM-IN" title="엔진 조절값" desc="손대지 않으면 엔진 기본값, 여기 넣은 값은 모든 후보에 똑같이 들어갑니다" pad>
        <div className="pi-params">
          {PARAM_FIELDS.map((f) => {
            const set = getIn(scen.params, f.path)
            return (
              <label key={f.path.join('.')}>
                <span>{f.label}</span>
                <NumericInput size="small" buttonPosition="none" className="plan-number" value={set ?? f.def} min={f.min} max={f.max} stepSize={f.step} minorStepSize={null}
                  onValueChange={(v) => setParam(f, v)} aria-label={f.label} />
                <small>{f.unit}, {f.note}{set != null
                  ? <> <button type="button" className="pi-reset" onClick={() => resetParam(f)}>기본값 {f.def}{f.unit}로</button></>
                  : <span className="faint"> (기본값)</span>}</small>
              </label>
            )
          })}
        </div>
        <p className="tiny muted pi-param-note">후보마다 프리셋이 따로 있습니다: {scen.presets.map((p) => `${p.label}${p.desc ? `(${p.desc})` : ''}`).join(', ')}. 여기 넣은 값이 프리셋 값보다 우선합니다.</p>
      </Panel>

      <Panel
        code="VESSEL-IN"
        title="선박"
        desc={`계획 기간 선박 ${scen.vessels.length}척, ETA만 고칠 수 있고 계약 값은 잠금`}
        data-tour="inputs"
        actions={<InputGroup size="small" leftIcon="search" placeholder="호출부호, 화물" value={query} onChange={(e) => setQuery(e.target.value)} className="pi-filter" aria-label="선박 거르기" />}
      >
        <div className="pi-scroll">
          <table className="dt pi-vessel-table">
            <caption className="plan-sr-only">선박별 제원, 수정 가능한 ETA, 잠긴 계약 값</caption>
            <thead>
              <tr>
                <th>선박</th><th>화물</th><th className="r">DWT</th><th className="r">흘수</th>
                <th><button type="button" className="pi-sort" onClick={() => setEtaDesc((x) => !x)} aria-label="ETA 순서 바꾸기">ETA <Icon icon={etaDesc ? 'caret-up' : 'caret-down'} size={11} /></button></th>
                <th className="r">{lock} 허용 h</th><th className="r">{lock} 일 체선료 $</th><th>갈 수 있는 부두</th>
              </tr>
            </thead>
            <tbody>
              {vessels.map((v) => {
                const fixed = scen.fixes.find((f) => f.vid === v.id)
                const codes = v.compat.map((id) => berthById[id]?.code ?? id)
                return (
                  <tr key={v.id}>
                    <td className="plan-nowrap">
                      <span className="plan-vessel-name mono" title={v.id}>{v.name}</span>
                      {fixed && <span className="chip accent pi-fix" title={`${berthById[fixed.bid]?.name ?? fixed.bid} ${fmt(fixed.etb)} 고정`}>고정</span>}
                      <div className="faint tiny">{v.cls}</div>
                    </td>
                    <td className="plan-nowrap">{v.product} <span className="muted">{v.dir}</span> <span className="num faint">{v.ton.toLocaleString()} t</span></td>
                    <td className="num r">{v.dwt.toLocaleString()}</td>
                    <td className="num r">{v.draft}m</td>
                    <td>
                      <InputGroup type="datetime-local" size="small" className="plan-datetime" aria-label={`${v.name} ETA`}
                        intent={v.eta == null ? 'danger' : undefined} value={v.eta == null ? '' : toInput(v.eta)} onChange={(e) => setEta(v.id, e.target.value)} />
                    </td>
                    <td className="num r pi-locked">{v.contract.laytimeH}</td>
                    <td className="num r pi-locked">{v.contract.rateUsd.toLocaleString()}</td>
                    <td className="pi-compat" title={codes.join(', ')}>
                      <span className="mono">{codes.slice(0, 6).join(' ')}</span>{codes.length > 6 && <span className="faint"> 외 {codes.length - 6}</span>}
                    </td>
                  </tr>
                )
              })}
              {!vessels.length && <tr><td colSpan={8} className="muted">「{query}」에 맞는 선박이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="plan-input-bottom">
        <Panel code="BERTH-IN" title="부두" desc={`SK 울산 부두 ${scen.berths.length}곳, 제원과 취급 제품`}>
          <div className="pi-scroll">
            <table className="dt pi-berth-table">
              <thead>
                <tr><th>부두</th><th className="r">최대 DWT</th><th className="r">최대 흘수</th><th className="r">최대 LOA</th><th>취급 제품</th><th>사용 불가</th></tr>
              </thead>
              <tbody>
                {piers.flatMap((g) => [
                  <tr key={`p-${g.pier}`} className="pi-pier-row"><td colSpan={6}>{g.name} <span className="faint">{g.list.length}곳</span></td></tr>,
                  ...g.list.map((b) => {
                    const bl = blocksOf(b.id)
                    return (
                      <tr key={b.id}>
                        <td className="plan-nowrap"><span className="mono">{b.code}</span> <span className="faint tiny">{b.size}</span></td>
                        <td className="num r">{b.maxDwt?.toLocaleString() ?? '-'}</td>
                        <td className="num r">{b.maxDraft ?? '-'}m</td>
                        <td className="num r">{b.maxLoa ?? '-'}m</td>
                        <td className="small muted pi-products">{b.products.join(', ') || '-'}</td>
                        <td className="small">{bl.length ? <span className="c-amber">{bl.map((x) => `${fmt(x.start)}~${fmt(x.end)}`).join(', ')}</span> : <span className="faint">없음</span>}</td>
                      </tr>
                    )
                  }),
                ])}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="plan-stack">
          <Panel code="BLOCK-IN" title="부두 사용 불가" desc="공사, 설비, 기상으로 못 쓰는 구간, 다시 계산할 때 엔진에 보냅니다"
            actions={<Button size="small" icon="add" onClick={addBlock}>구간 추가</Button>}>
            {scen.blocks.length === 0 ? <p className="small muted pi-empty">등록된 구간이 없습니다.</p> : (
              <table className="dt pi-block-table">
                <thead><tr><th>부두</th><th>시작</th><th>종료</th><th>종류</th><th /></tr></thead>
                <tbody>
                  {scen.blocks.map((b, i) => {
                    const val = b.berths ? b.berths.join(',') : 'ALL'
                    const multi = b.berths && b.berths.length > 1
                    return (
                      <tr key={b.id ?? b.incId ?? i} className={b.incId ? 'pi-inc-row' : ''}>
                        <td>
                          <HTMLSelect value={val} aria-label={`사용 불가 ${i + 1}번 부두`}
                            onChange={(e) => editBlock(i, (x) => { x.berths = e.target.value === 'ALL' ? null : e.target.value.split(',') })}>
                            <option value="ALL">전 부두</option>
                            {multi && <option value={val}>{berthsText(b, berthById)}</option>}
                            {scen.berths.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
                          </HTMLSelect>
                          {b.source && <div className="faint tiny">{b.source}</div>}
                        </td>
                        <td><InputGroup type="datetime-local" size="small" className="plan-datetime" aria-label={`사용 불가 ${i + 1}번 시작`} value={toInput(b.start)} onChange={(e) => setBlockTime(i, 'start', e.target.value)} /></td>
                        <td><InputGroup type="datetime-local" size="small" className="plan-datetime" aria-label={`사용 불가 ${i + 1}번 종료`} intent={b.end > b.start ? undefined : 'danger'} value={toInput(b.end)} onChange={(e) => setBlockTime(i, 'end', e.target.value)} /></td>
                        <td>
                          <HTMLSelect value={b.kind} aria-label={`사용 불가 ${i + 1}번 종류`} onChange={(e) => editBlock(i, (x) => { x.kind = e.target.value })}>
                            {Object.entries(BLOCK_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </HTMLSelect>
                        </td>
                        <td className="r"><Button size="small" variant="minimal" icon="trash" aria-label={`사용 불가 ${i + 1}번 지우기`} onClick={() => removeBlock(i)} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel code="WIND-IN" title="풍속" desc="기상 관측(부이), 1시간 간격, 계획 기간" data-tour="env" pad>
            <WindChart wind={wind} win={scen.window} />
            <p className="tiny muted pi-wind-note">
              {maxWind ? <>최대 <b className={`num ${maxWind.ms >= WIND_LIMIT ? 'c-red' : ''}`}>{maxWind.ms} m/s</b> ({fmt(maxWind.t)}). </> : '계획 기간 관측값이 없습니다. '}
              엔진 기상 기준: 3~8부두와 부이는 {WIND_LIMIT} m/s, 1~2부두와 가스부두는 18 m/s 이상이면 하역을 멈춰 작업 완료가 늦어집니다(접안 불가는 20~21 m/s).
              체선료의 기상 공제는 풍속이 아니라 「부두 사용 불가」의 기상 구간에만 적용됩니다.
              {wind.some((w) => w.thunder || w.typhoon) && ' 뇌우나 태풍 표시가 있는 시간은 빨간 점입니다.'}
            </p>
          </Panel>
        </div>
      </div>
    </Screen>
  )
}

/** 계획 기간 풍속 선 그래프. 14 m/s 점선이 멈춤 기준이다. */
function WindChart({ wind, win }) {
  if (!wind.length) return <p className="small muted">관측값 없음</p>
  const W = 600, H = 120, L = 24, R = 6, T = 8, B = 18
  const top = Math.max(WIND_LIMIT + 2, ...wind.map((w) => w.ms))
  const x = (t) => L + ((t - win.start) / Math.max(1, win.end - win.start)) * (W - L - R)
  const y = (ms) => T + (1 - ms / top) * (H - T - B)
  const path = wind.map((w, i) => `${i ? 'L' : 'M'}${x(w.t).toFixed(1)},${y(w.ms).toFixed(1)}`).join(' ')
  // KST 0시 눈금 (기준 T = 09:00 KST이므로 0시는 T + 15시간 + 24시간 × n)
  const days = []
  for (let t = win.start + (((15 * 60 - win.start) % 1440) + 1440) % 1440; t <= win.end; t += 1440) days.push(t)
  return (
    <svg className="pi-wind" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`풍속 그래프, 최대 ${Math.max(...wind.map((w) => w.ms))} m/s`}>
      {[0, 5, 10].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="pi-wind-grid" /><text x={L - 4} y={y(v) + 3} className="pi-wind-tick" textAnchor="end">{v}</text></g>)}
      {days.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={T} y2={H - B} className="pi-wind-grid" /><text x={x(t) + 3} y={H - 5} className="pi-wind-tick">{fmt(t).slice(0, 5)}</text></g>)}
      <line x1={L} x2={W - R} y1={y(WIND_LIMIT)} y2={y(WIND_LIMIT)} className="pi-wind-limit" />
      <text x={W - R} y={y(WIND_LIMIT) - 3} className="pi-wind-tick limit" textAnchor="end">{WIND_LIMIT} m/s</text>
      <path d={path} className="pi-wind-line" />
      {wind.filter((w) => w.thunder || w.typhoon).map((w) => <circle key={w.t} cx={x(w.t)} cy={y(w.ms)} r={2.5} className="pi-wind-alert" />)}
    </svg>
  )
}
