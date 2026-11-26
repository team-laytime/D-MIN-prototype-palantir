// 계획 조건 (11-24 실데이터): 데이터 팀 묶음의 선박, 부두, 기상을 보여 주고 스케줄러가 고칠 수 있는 값만 연다.
//  - 고칠 수 있는 값: 선박 ETA, 부두 사용 불가 구간(blocks), 엔진 조절값(params)
//  - 계약 값(허용 시간, 일 체선료)은 잠금. 체선료는 화면에서 계산하지 않고 「다시 계산」으로 팀 엔진에 보낸다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Callout, Checkbox, Dialog, DialogBody, Icon, InputGroup, NonIdealState, Spinner } from '@blueprintjs/core'
import { BLOCK_KINDS, PARAM_FIELDS, SHIFT_DEFAULT, SHIFT_LABEL, SHIFT_MAX_H, TANK_RULE, WIND_GROUPS, getIn, shiftGroup } from '../lib/scenDiff.js'
import { fmt, fmtFull, fromInput, toInput, toMin } from '../lib/time.js'
import { useApp } from '../state/app.jsx'
import { useInbox } from '../state/useInbox.js'
import { changeText } from '../lib/incidents.js'
import { St } from '../ui/kit.jsx'
import { vesselIdOf } from '../lib/dataset.js'
import { Screen } from '../ui/kit.jsx'
import './plan.css'

const WIND_LIMIT = 14 // m/s, 3~8부두와 부이의 하역 중단 기준(팀 엔진 weather.py). 1~2부두와 가스부두는 18
const berthsText = (b, byId) => (b.berths ? b.berths.map((id) => byId[id]?.code ?? id).join(', ') : '전 부두')

export default function ScenarioInput() {
  const { scenInput: scen, editScen, version, result, recalc, go, pendingIncs, decideMails } = useApp()
  // 11-26 받은 메일 조건 변경 체크(반영할 것). 상단 「후보 비교」를 누를 때 한꺼번에 결정한다
  const [mailPick, setMailPick] = useState({})
  const [query, setQuery] = useState('')
  const [etaDesc, setEtaDesc] = useState(false)
  const [piTab, setPiTab] = useState('vessel')

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
  const fieldOf = (path) => PARAM_FIELDS.find((f) => f.path.join('.') === path)
  // 계획용 풍속 기준: 엔진은 thresholds_ms를 통째로 바꾸므로 두 그룹을 함께 보낸다
  const windDef = scen.windDefault ?? { '#1~2·GAS': [18, 20], '#3~7': [WIND_LIMIT, 21] }
  const windCur = scen.params.weather?.thresholds_ms ?? windDef
  const setWind = (key, v) => {
    const def = windDef[key][0]
    if (!Number.isFinite(v) || v < 5 || v > def || v === windCur[key][0]) return
    editScen((d) => {
      const next = { ...structuredClone(windDef), ...structuredClone(d.params.weather?.thresholds_ms ?? {}) }
      next[key] = [v, next[key][1]]
      const same = WIND_GROUPS.every((g) => next[g.key][0] === windDef[g.key][0])
      if (same) { if (d.params.weather) { delete d.params.weather.thresholds_ms; if (!Object.keys(d.params.weather).length) delete d.params.weather } return }
      ;(d.params.weather ??= {}).thresholds_ms = next
    })
  }
  const planWind = windCur['#3~7'][0]
  if (pv(PARAM_FIELDS[0]) >= pv(PARAM_FIELDS[1])) errors.push('안전재고 하한이 상한보다 작아야 합니다')
  if (pv(PARAM_FIELDS[0]) < TANK_RULE.min || pv(PARAM_FIELDS[1]) > TANK_RULE.max) errors.push(`안전재고는 ${TANK_RULE.min}% 미만, ${TANK_RULE.max}% 초과로 정할 수 없습니다`)

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
  // 11-26 부두 그룹별 Switching · Direction (idx 0 · 1). 기본값과 같아지면 계획 조건에서 뺀다
  const shiftDef = { ...SHIFT_DEFAULT, ...(scen.shiftDefault ?? {}) }
  const shiftOf = (g) => scen.params.shifting?.hours?.[g] ?? shiftDef[g] ?? [0, 0]
  const setShift = (g, idx, v) => {
    const def = shiftDef[g] ?? [0, 0]
    if (v < def[idx]) return `기본값 ${def[idx]}h 미만으로는 설정할 수 없습니다.`
    if (v > SHIFT_MAX_H) return `${SHIFT_MAX_H}h 이하로 입력해 주세요.`
    // 엔진은 shifting.hours를 통째로 바꾼다(그룹 하나만 보내면 나머지 그룹이 없어 계산이 실패) → 항상 표 전체를 보낸다
    editScen((d) => {
      const hrs = { ...structuredClone(shiftDef), ...structuredClone(d.params.shifting?.hours ?? {}) }
      hrs[g] = [...hrs[g]]
      hrs[g][idx] = v
      const same = Object.keys(shiftDef).every((k) => hrs[k][0] === shiftDef[k][0] && hrs[k][1] === shiftDef[k][1])
      if (same) {
        if (d.params.shifting) { delete d.params.shifting.hours; if (!Object.keys(d.params.shifting).length) delete d.params.shifting }
      } else (d.params.shifting ??= {}).hours = hrs
    })
    return null
  }
  const resetParam = (f) => editScen((d) => {
    const [g, k] = f.path
    if (!d.params[g]) return
    delete d.params[g][k]
    if (!Object.keys(d.params[g]).length) delete d.params[g]
  })
  const addBlock = (bid) => editScen((d) => {
    const start = Math.max(0, d.window.start)
    d.blocks.push({ id: `blk-${Date.now()}`, berths: [bid ?? d.berths[0].id], start, end: start + 6 * 60, kind: 'CONSTRUCTION', source: '스케줄러 입력' })
  })
  const editBlock = (i, fn) => editScen((d) => fn(d.blocks[i]))
  const removeBlock = (i) => editScen((d) => { d.blocks.splice(i, 1) })
  const setBlockTime = (i, field, value) => {
    const t = fromInput(value)
    if (t !== null && t !== scen.blocks[i][field]) editBlock(i, (b) => { b[field] = t })
  }

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
  const best = result.candidates[0]
  // 계약 칸 중 데이터에 비어 있으면 화면 모델이 기본값으로 채우는 것(NOR 뒤 개시, 기상 공제)은 원본 요청에서 본다
  const rawById = Object.fromEntries((scen.request?.vessels ?? []).map((x) => [vesselIdOf(x), x]))
  const rawOf = (v) => rawById[v.id]
  // 11-26 기준 시각을 새로 열 때의 첫 후보 계산(result.boot)은 뒤에서 도는 것이라 여기서는 계산 중이라고 알리지 않는다
  const running = result.running && !result.boot
  const calcState = running ? 'run' : result.calcError ? 'bad' : result.stale ? 'warn' : 'ok'

  return (
    <Screen
      tab="input"
      title="계획 조건"
      step={1}
      bodyClass="plan-input plan-stack"
      actions={<>
        <Button intent={result.stale ? 'warning' : 'none'} icon={running ? <Spinner size={14} /> : 'refresh'} disabled={!canRecalc} onClick={() => recalc()}>
          {running ? '계산 중, 약 1분' : '다시 계산'}
        </Button>
        <Button intent="primary" endIcon="arrow-right" disabled={!result.candidates.length && !pendingIncs.length}
          title={pendingIncs.length ? '체크한 메일은 반영, 나머지는 반영 안 함으로 정하고 후보 비교로 갑니다' : undefined}
          onClick={() => { if (pendingIncs.length) { decideMails(pendingIncs.filter((i) => mailPick[i.id]).map((i) => i.id)); setMailPick({}) } go('compare') }}>후보 비교</Button>
      </>}
    >

      {calcState !== 'ok' && <div className={`pi-calc ${calcState}`} data-tour="recalc">
        {calcState === 'run' ? <><Spinner size={14} /><b>계산 중, 약 1분</b><span className="muted">후보 {scen.presets.length}개를 동시에 계산합니다.</span></>
          : calcState === 'bad' ? <><Icon icon="error" size={14} /><b>다시 계산하지 못했습니다</b><span>{result.calcError}</span></>
            : calcState === 'warn' ? <><Icon icon="warning-sign" size={14} /><b>계획 조건이 바뀌었습니다</b><span>지금 후보는 바뀌기 전 조건으로 계산한 것입니다. 「다시 계산」을 눌러야 반영됩니다.</span></>
              : null}
        {(calcState === 'warn' || calcState === 'bad') && (
          <Button size="small" intent="warning" icon="refresh" disabled={!canRecalc} onClick={() => recalc()}>다시 계산</Button>
        )}
      </div>}

      <MailChanges scen={scen} pick={mailPick} setPick={setMailPick} />

      {errors.length > 0 && (
        <Callout intent="danger" icon="error" title={`입력 오류 ${errors.length}건, 고쳐야 다시 계산할 수 있습니다`} className="plan-errors">
          <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Callout>
      )}

      {/* 11-25 계획 조건을 묶음별 탭으로 나눈다: 선박 / 부두(선석) / 엔진 조절값 / 기상. 탭마다 선 그림 아이콘 */}
      <div className="pi-tabs" role="tablist" aria-label="계획 조건 묶음">
        {[
          { id: 'vessel', label: '선박', meta: `${scen.vessels.length}척` },
          { id: 'berth', label: '부두(선석)', meta: `${scen.berths.length}곳${scen.blocks.length ? `, 사용 불가 ${scen.blocks.length}` : ''}` },
          { id: 'weather', label: '운영 여건', meta: '생산계획, 날씨 등' },
        ].map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={piTab === t.id} className={piTab === t.id ? 'on' : ''} onClick={() => setPiTab(t.id)}>
            <TabIcon kind={t.id} /><b>{t.label}</b><span>{t.meta}</span>
          </button>
        ))}
      </div>

      {/* 11-25 선박 탭: 목록에는 고칠 수 있는 값(ETA)만 둔다. 제원, 화물, 계약 조건은 배를 누르면 오른쪽에,
          두 척을 고르면 나란히 비교로 보여 준다. */}
      {piTab === 'vessel' && (
        <VesselTab scen={scen} vessels={vessels} query={query} setQuery={setQuery} etaDesc={etaDesc} setEtaDesc={setEtaDesc}
          setEta={setEta} rawOf={rawOf} berthById={berthById} />
      )}

      {/* 11-25 부두 탭: 목록(선석, 사용 불가) + 오른쪽 상세(제원, 취급 제품, 사용 불가 구간 편집) */}
      {piTab === 'berth' && (
        <BerthTab scen={scen} piers={piers} blocksOf={blocksOf} addBlock={addBlock} editBlock={editBlock} removeBlock={removeBlock} setBlockTime={setBlockTime}
          shift={{ of: shiftOf, def: shiftDef, set: setShift }} />
      )}

      {/* 11-25 운영 여건: 생산계획과 탱크 재고(최적화 팀 후보정 값), 관측 풍속. 모두 계획 입력이라 고치지 않는다 */}
      {piTab === 'weather' && (
        <div className="env" data-tour="env">
          <TankPlan tanks={scen.tanks ?? []} win={scen.window} safe={[pv(fieldOf('tank.safe_min_pct')), pv(fieldOf('tank.safe_max_pct'))]}
            inputs={<><ParamInput f={fieldOf('tank.safe_min_pct')} scen={scen} setParam={setParam} resetParam={resetParam} /><ParamInput f={fieldOf('tank.safe_max_pct')} scen={scen} setParam={setParam} resetParam={resetParam} /></>} />
          <div className="env-2">
            <Occupied list={scen.occupied ?? []} berthById={berthById} />
            <NightPilot rule={scen.nightPilot} vessels={scen.vessels} />
          </div>
          <section className="wx">
            <header className="wx-head">
              <h3>풍속</h3>
              <div><span>최대 풍속</span><b className={maxWind && maxWind.ms >= planWind ? 'c-red' : ''}>{maxWind ? <>{maxWind.ms.toFixed(1)} m/s <small className="wx-at">{fmt(maxWind.t)}</small></> : '-'}</b></div>
              <div className="wx-plan">
                <span>계획용 하역 중단 풍속</span>
                <div className="wx-inputs">
                  {WIND_GROUPS.map((g) => {
                    const def = windDef[g.key][0], cur = windCur[g.key][0]
                    return (
                      <label key={g.key} className={`pin ${cur !== def ? 'changed' : ''}`}>
                        <span className="pin-k">{g.label}</span>
                        <NumField value={cur} label={`${g.label} 계획용 하역 중단 풍속`}
                          onCommit={(v) => (v > def ? `계획용 풍속 기준은 하역 중단 기준 ${def} m/s보다 높게 잡을 수 없습니다.`
                            : v < 5 ? '계획용 풍속 기준은 5 m/s 이상이어야 합니다.' : (setWind(g.key, v), null))} />
                        <span className="pin-u">m/s</span>
                        {cur !== def
                          ? <button type="button" className="vt-undo" title={`기준 ${def} m/s로`} aria-label={`${g.label} 기준값으로`} onClick={() => setWind(g.key, def)}><Icon icon="undo" size={13} /></button>
                          : <span className="pin-def">기준</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            </header>
            <div className="wx-chart"><WindChart wind={wind} win={scen.window} plan={planWind} stop={windDef['#3~7'][0]} groups={WIND_GROUPS.map((g) => ({ ...g, stop: windDef[g.key][0], leave: windDef[g.key][1] }))} /></div>
          </section>
        </div>
      )}
    </Screen>
  )
}

/**
 * 11-26 날짜 · 시각 칸: 고르는 창(브라우저 달력)은 연도까지 고른다. 칸에는 「2025/11/03 15:47」, 화면이 좁으면 연도를 빼고
 * 「11/03 15:47」만 보인다(시각이 잘리지 않게). 칸을 누르면 달력이 열린다. onChange는 datetime-local 값('YYYY-MM-DDTHH:mm')
 */
function DateTimeField({ value, label, onChange, bad = false }) {
  const ref = useRef(null)
  const open = () => { const el = ref.current; if (!el) return; try { el.showPicker() } catch { el.focus() } }
  return (
    <span className={`dtf ${bad ? 'bad' : ''}`}>
      <button type="button" className="dtf-text num" onClick={open} aria-label={`${label}: ${value == null ? '없음' : fmt(value)} (바꾸기)`}>
        {value == null ? '—' : <span><span className="dtf-y">{fmtFull(value).slice(0, 5).replace('-', '/')}</span>{fmt(value)}</span>}<Icon icon="calendar" size={12} />
      </button>
      <input ref={ref} type="datetime-local" className="dtf-input" tabIndex={-1} aria-hidden="true" value={value == null ? '' : toInput(value)} onChange={(e) => onChange(e.target.value)} />
    </span>
  )
}

/** 숫자 칸: 입력을 끝낼 때(Enter, 칸 벗어남) 확정한다. onCommit이 문구를 돌려주면 경고창을 띄우고 원래 값으로 돌린 뒤 다시 입력하게 한다 */
function NumField({ value, label, onCommit }) {
  const [draft, setDraft] = useState(String(value))
  const [warn, setWarn] = useState(null)
  const ref = useRef(null)
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = () => {
    const t = draft.trim()
    const v = Number(t)
    if (t === '' || !Number.isFinite(v)) { setDraft(String(value)); return }
    if (v === value) return
    const msg = onCommit(v)
    if (msg) setWarn(msg)
  }
  return (
    <>
      <input ref={ref} className="pin-in" inputMode="decimal" value={draft} aria-label={label}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(String(value)); e.currentTarget.blur() } }} />
      <Alert isOpen={!!warn} icon="warning-sign" intent="warning" confirmButtonText="다시 입력"
        onClose={() => { setWarn(null); setDraft(String(value)); setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 0) }}>
        <p className="num-warn">{warn}</p>
        <p className="num-warn sub">다른 값을 입력해 주세요.</p>
      </Alert>
    </>
  )
}

/** 고칠 수 있는 엔진 값 한 칸: 이름, 값, 단위, 기본값과 되돌리기 */
function ParamInput({ f, scen, setParam, resetParam }) {
  const set = getIn(scen.params, f.path)
  const changed = set != null && set !== f.def
  const val = (path) => { const x = PARAM_FIELDS.find((y) => y.path.join('.') === path); return getIn(scen.params, x.path) ?? x.def }
  const check = (v) => {
    if (f.path[0] === 'tank') {
      if (v < TANK_RULE.min || v > TANK_RULE.max) return `안전재고는 ${TANK_RULE.min}% 미만, ${TANK_RULE.max}% 초과로 설정할 수 없습니다.`
      if (f.path[1] === 'safe_min_pct' && v >= val('tank.safe_max_pct')) return `안전재고 하한은 상한(${val('tank.safe_max_pct')}%)보다 작아야 합니다.`
      if (f.path[1] === 'safe_max_pct' && v <= val('tank.safe_min_pct')) return `안전재고 상한은 하한(${val('tank.safe_min_pct')}%)보다 커야 합니다.`
    } else if (v < f.min || v > f.max) return `${f.label}은 ${f.min}~${f.max}${f.unit} 사이로 입력해 주세요.`
    setParam(f, v)
    return null
  }
  return (
    <label className={`pin ${changed ? 'changed' : ''}`}>
      <span className="pin-k">{f.label}</span>
      <NumField value={set ?? f.def} label={f.label} onCommit={check} />
      <span className="pin-u">{f.unit}</span>
      {set != null
        ? <button type="button" className="vt-undo" title={`기본값 ${f.def}${f.unit}로`} aria-label={`${f.label} 기본값으로`} onClick={() => resetParam(f)}><Icon icon="undo" size={13} /></button>
        : <span className="pin-def">기본</span>}
    </label>
  )
}

/** 생산계획과 탱크 재고: 탱크 묶음마다 시간별 재고 흐름(기존 계획대로, 최적화 전), 안전 범위 띠, 주별 생산, 공정 투입 */
function TankPlan({ tanks, win, safe, inputs }) {
  if (!tanks.length) return null
  const weeks = tanks[0].weeks
  const W = 600, H = 56
  // 시간축: 기준 시각부터 계획 창 끝까지. 0시 눈금
  const t0 = win.start, t1 = win.end
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W
  const days = []
  for (let t = t0 + (((15 * 60 - t0) % 1440) + 1440) % 1440; t < t1; t += 1440) days.push(t)
  const rate = (r) => (r == null ? '-' : r >= 0 ? `생산 ${Math.round(r).toLocaleString()}` : `투입 ${Math.round(-r).toLocaleString()}`)
  const [lo, hi] = safe
  const y = (pct) => H - (Math.max(0, Math.min(100, pct)) / 100) * H
  return (
    <section className="tp">
      <header className="tp-head">
        <h3>생산계획과 탱크 재고</h3>
        <div className="tp-inputs">{inputs}</div>
      </header>
      <table className="tp-table">
        <colgroup><col className="tp-c-name" /><col className="tp-c-now" /><col />{weeks.map((w) => <col key={w.from} className="tp-c-rate" />)}</colgroup>
        <thead>
          <tr>
            <th>탱크 묶음</th>
            <th className="r">현재</th>
            <th className="tp-axis-h">
              <span className="tp-axis-t">재고 흐름 <small>기존 계획대로</small></span>
              <svg className="tp-axis" viewBox={`0 0 ${W} 14`} preserveAspectRatio="none" aria-hidden="true">
                {days.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={8} y2={14} />)}
              </svg>
              <div className="tp-days">{days.map((t) => <span key={t} style={{ left: `${(x(t) / W) * 100}%` }}>{fmt(t).slice(0, 5)}</span>)}</div>
            </th>
            {weeks.map((w, i) => <th key={w.from} className="r">{i === 0 ? '이번 주' : `${fmt(w.from).slice(0, 5)}부터`} <small>t/h</small></th>)}
          </tr>
        </thead>
        <tbody>
          {tanks.map((t) => {
            const f = t.base
            const step = f?.step ?? 60
            const fs = f?.start ?? null
            const pts = f ? f.lv.map((lv, i) => [x(fs + i * step), y((lv / t.cap) * 100), (lv / t.cap) * 100]).filter(([px]) => px >= 0 && px <= W) : []
            const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
            const minP = pts.length ? Math.min(...pts.map((p) => p[2])) : null
            const maxP = pts.length ? Math.max(...pts.map((p) => p[2])) : null
            const out = pts.some((p) => p[2] < lo || p[2] >= hi)
            const now = (t.start / t.cap) * 100
            return (
              <tr key={t.name}>
                <th>{t.name}<small>{t.count}개</small></th>
                <td className="r tp-now"><b>{now.toFixed(0)}%</b></td>
                <td className="tp-spark">
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${t.name} 재고 ${minP?.toFixed(0)}~${maxP?.toFixed(0)}%`}>
                    <rect x={0} y={y(hi)} width={W} height={y(lo) - y(hi)} className="tp-band" />
                    {days.map((d) => <line key={d} x1={x(d)} x2={x(d)} y1={0} y2={H} className="tp-grid" />)}
                    <path d={`${line} L${pts.at(-1)?.[0] ?? 0},${H} L0,${H} Z`} className="tp-area" />
                    <path d={line} className={`tp-line ${out ? 'out' : ''}`} vectorEffect="non-scaling-stroke" />
                  </svg>
                  <span className="tp-range">{minP != null ? `${minP.toFixed(0)}~${maxP.toFixed(0)}%` : '-'}</span>
                </td>
                {weeks.map((w, i) => {
                  const r = t.weeks[i]?.rate
                  return <td key={w.from} className={`r tp-rate ${r >= 0 ? 'up' : 'down'}`}>{rate(r)}</td>
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

/** 기준 시각에 이미 접안해 작업 중인 배: 예상 이안 시각부터 그 선석에 계획 대상 배가 들어갈 수 있다 */
function Occupied({ list, berthById }) {
  return (
    <section className="tp env-box">
      <header className="tp-head"><h3>현재 접안 중인 배</h3><span className="env-count">{list.length}척</span></header>
      {list.length === 0 ? <div className="bt-none">없음</div> : (
        <table className="env-table">
          <thead><tr><th>선석</th><th>선박</th><th>화물</th><th className="r">예상 이안 시각</th></tr></thead>
          <tbody>
            {list.map((o) => (
              <tr key={`${o.bid}-${o.etb}`}>
                <th>{berthById[o.bid]?.label ?? o.bid}</th>
                <td>{o.name}</td>
                <td>{o.product} {o.dir}</td>
                <td className="r num">{fmt(o.etu)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** 야간 도선 제한: 규칙(엔진 파라미터)과 이번 계획에서 대상인 배 */
function NightPilot({ rule, vessels }) {
  if (!rule) return null
  const hit = (v) => v.grt != null && (v.grt >= rule.grt_always || (v.grt >= rule.grt_min && v.biz === 'IM' && v.draft != null && v.draft >= rule.draft_min))
  const list = vessels.filter(hit)
  const n = (x) => x.toLocaleString()
  return (
    <section className="tp env-box">
      <header className="tp-head"><h3>야간 도선 제한</h3><span className="env-count">대상 {list.length}척</span></header>
      <dl className="np-rule">
        <dt>대상</dt><dd>GRT {n(rule.grt_always)} t 이상, 또는 GRT {n(rule.grt_min)} t 이상이면서 흘수 {rule.draft_min} m 이상인 수입선</dd>
        <dt>접안 불가</dt><dd>{rule.night_start} ~ {rule.release}, 이 사이 접안은 {rule.release}로 미룸</dd>
        <dt>도선 마감</dt><dd>일몰 {rule.pob_before_sunset_small_h}시간 전 (GRT {n(rule.grt_pob_2h)} t 초과는 {rule.pob_before_sunset_large_h}시간 전), 그 뒤 도착하면 다음 날 {rule.release}</dd>
      </dl>
      {list.length > 0 && (
        <table className="env-table">
          <thead><tr><th>선박</th><th className="r">GRT</th><th className="r">흘수</th><th className="r">ETA</th></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id}><th>{v.name}</th><td className="r num">{n(v.grt)}</td><td className="r num">{v.draft} m</td><td className="r num">{fmt(v.eta)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** 탭 그림: 선박, 부두(잔교와 계선주), 운영 여건(탱크와 바람). 24 격자 선 그림 */
function TabIcon({ kind }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <svg className="pi-ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {kind === 'vessel' && <g {...p}><path d="M2.5 14.5h19l-2.6 4.5H5.1z" /><path d="M7 14.5V10h7v4.5" /><path d="M9.5 10V6.5h2.2V10" /><path d="M16 14.5v-2.5h2.5v2.5" /></g>}
      {kind === 'berth' && <g {...p}><path d="M2 12.5h20" /><path d="M2 15h20" /><path d="M5 15v5.5M12 15v5.5M19 15v5.5" /><path d="M8 12.5V9.5h2.6v3" /><path d="M7.4 9.5h3.8" /><path d="M14.5 6.5c1.5-1.5 3.5-1.5 5 0" /></g>}
      {kind === 'weather' && <g {...p}><path d="M4 20V9.5a3.5 2 0 0 1 7 0V20" /><path d="M4 13.5h7" /><path d="M13.5 8h5.5a2.25 2.25 0 1 0-2.25-2.25" /><path d="M13.5 11.5h7.5a2.25 2.25 0 1 1-2.25 2.25" /><path d="M2.5 20h19" /></g>}
    </svg>
  )
}

/** 부두 탭: 왼쪽 선석 목록, 오른쪽 그 선석의 제원과 사용 불가 구간(고칠 수 있음) */
function BerthTab({ scen, piers, blocksOf, addBlock, editBlock, removeBlock, setBlockTime, shift }) {
  const [openId, setOpenId] = useState(scen.berths[0]?.id ?? null)
  const b = scen.berths.find((x) => x.id === openId) ?? scen.berths[0]
  const mine = scen.blocks.map((x, i) => ({ x, i })).filter(({ x }) => !x.berths || x.berths.includes(b.id))
  const label = (x) => x.label ?? x.code
  return (
    <div className="vt bt">
      <section className="vt-list">
        <div className="vt-scroll">
          <table className="vt-table bt-table">
            <caption className="plan-sr-only">선석과 사용 불가 구간</caption>
            <colgroup><col /><col className="bt-c-st" /><col className="bt-c-sh" /><col className="bt-c-sh" /></colgroup>
            <thead><tr><th>선석</th><th>사용 불가</th><th className="r" title="앞 선박 이안 뒤 다음 접안까지">Switching</th><th className="r" title="ETA 뒤 접안까지">Direction</th></tr></thead>
            {piers.map((g) => (
              <tbody key={g.pier}>
                <tr className="bt-pier"><th colSpan={4}>{g.name}</th></tr>
                {g.list.map((x) => {
                  const bl = blocksOf(x.id)
                  return (
                    <tr key={x.id} className={x.id === b.id ? 'open' : ''} onClick={() => setOpenId(x.id)}>
                      <td className="vt-name">{label(x)}</td>
                      <td className={`bt-st ${bl.length ? 'on' : ''}`}>{bl.length ? `${bl.length}건` : '없음'}</td>
                      {[0, 1].map((k) => {
                        const gp = shiftGroup(x.id), v = shift.of(gp)[k]
                        return (
                          <td key={k} className={`r bt-sh ${v !== shift.def[gp]?.[k] ? 'changed' : ''}`} onClick={(e) => e.stopPropagation()}
                            title={`${SHIFT_LABEL[gp] ?? gp} 공통 · 기본값 ${shift.def[gp]?.[k]}h 미만 불가`}>
                            <NumField value={v} label={`${label(x)} ${k ? 'Direction' : 'Switching'} (${SHIFT_LABEL[gp] ?? gp} 공통)`} onCommit={(nv) => shift.set(gp, k, nv)} />
                            <span className="pin-u">h</span>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <section className="vt-side">
        <div className="vd2">
          <header className="vd2-head"><h3>{label(b)}</h3></header>
          <div className="vd2-body bt-body">
            <table className="vd2-grid">
              <caption>제원</caption>
              <tbody>
                <tr><th>최대 DWT</th><td>{b.maxDwt != null ? `${b.maxDwt.toLocaleString()} t` : '-'}</td></tr>
                <tr><th>최대 흘수</th><td>{b.maxDraft != null ? `${b.maxDraft} m` : '-'}</td></tr>
                <tr><th>LOA</th><td>{b.minLoa != null ? `${b.minLoa} ~ ` : ''}{b.maxLoa != null ? `${b.maxLoa} m` : '-'}</td></tr>
                <tr><th>크기</th><td>{b.size ?? '-'}</td></tr>
              </tbody>
            </table>
            <div className="bt-prod">
              <div className="bt-cap">취급 제품 <span>{b.products.length}</span></div>
              <ul>{b.products.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>

            <div className="bt-blocks">
              <div className="bt-cap">
                사용 불가 구간
                <Button className="bt-add" icon="add" onClick={() => addBlock(b.id)}>구간 추가</Button>
              </div>
              {mine.length === 0
                ? <div className="bt-none">등록된 구간 없음</div>
                : (
                  <table className="bt-block-table">
                    <thead><tr><th>시작</th><th>종료</th><th>종류</th><th>대상</th><th /></tr></thead>
                    <tbody>
                      {mine.map(({ x, i }) => (
                        <tr key={x.id ?? x.incId ?? i} className={x.incId ? 'inc' : ''}>
                          <td><DateTimeField value={x.start} label={`사용 불가 ${i + 1}번 시작`} onChange={(t) => setBlockTime(i, 'start', t)} /></td>
                          <td><DateTimeField value={x.end} bad={!(x.end > x.start)} label={`사용 불가 ${i + 1}번 종료`} onChange={(t) => setBlockTime(i, 'end', t)} /></td>
                          <td>
                            <select className="bt-select" value={x.kind} aria-label={`사용 불가 ${i + 1}번 종류`} onChange={(e) => editBlock(i, (y) => { y.kind = e.target.value })}>
                              {Object.entries(BLOCK_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="bt-select" value={x.berths ? 'ONE' : 'ALL'} aria-label={`사용 불가 ${i + 1}번 대상`}
                              onChange={(e) => editBlock(i, (y) => { y.berths = e.target.value === 'ALL' ? null : [b.id] })}>
                              <option value="ONE">{x.berths && x.berths.length > 1 ? `${x.berths.length}개 선석` : '이 선석'}</option>
                              <option value="ALL">전 부두</option>
                            </select>
                          </td>
                          <td className="r"><button type="button" className="vt-undo" aria-label={`사용 불가 ${i + 1}번 지우기`} title="지우기" onClick={() => removeBlock(i)}><Icon icon="trash" size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

/** 선박 탭: 왼쪽 목록(선박, ETA) + 오른쪽 상세 또는 두 척 비교 */
function VesselTab({ scen, vessels, query, setQuery, etaDesc, setEtaDesc, setEta, rawOf, berthById }) {
  const [openId, setOpenId] = useState(null)
  const [picked, setPicked] = useState([]) // 비교할 배 (최대 2척)
  const [comparing, setComparing] = useState(false)
  const byId = useMemo(() => Object.fromEntries(scen.vessels.map((v) => [v.id, v])), [scen.vessels])
  const open = byId[openId] ?? vessels[0] ?? null
  const pair = picked.map((id) => byId[id]).filter(Boolean)
  const showCompare = comparing && pair.length === 2
  const etaOf = (v) => toMin(rawOf(v)?.eta)
  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)))

  return (
    <div className="vt">
      <section className="vt-list">
        <div className="vt-bar">
          <InputGroup leftIcon="search" placeholder="선박명 또는 화물" value={query} onChange={(e) => setQuery(e.target.value)} className="vt-search" aria-label="선박 거르기" />
          <Button className="vt-cmp-btn" intent={pair.length === 2 ? 'primary' : 'none'} icon="comparison" disabled={pair.length !== 2}
            onClick={() => setComparing(true)}>비교하기{picked.length ? ` ${picked.length}/2` : ''}</Button>
        </div>
        <div className="vt-scroll">
          <table className="vt-table">
            <caption className="plan-sr-only">선박과 고칠 수 있는 ETA</caption>
            <colgroup><col className="vt-c-pick" /><col /><col className="vt-c-eta" /></colgroup>
            <thead>
              <tr>
                <th aria-label="비교 선택" />
                <th>선박</th>
                <th><button type="button" className="pi-sort" onClick={() => setEtaDesc((x) => !x)} aria-label="ETA 순서 바꾸기">ETA <Icon icon={etaDesc ? 'caret-up' : 'caret-down'} size={12} /></button></th>
              </tr>
            </thead>
            <tbody>
              {vessels.map((v) => {
                const fixed = scen.fixes.find((f) => f.vid === v.id)
                const changed = v.eta != null && etaOf(v) != null && v.eta !== etaOf(v)
                const isOpen = !showCompare && open?.id === v.id
                const isPicked = picked.includes(v.id)
                return (
                  <tr key={v.id} className={`${isOpen ? 'open' : ''} ${isPicked ? 'picked' : ''}`} onClick={() => { setOpenId(v.id); setComparing(false) }}>
                    <td className="vt-pick" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isPicked} onChange={() => togglePick(v.id)} aria-label={`${v.name} 비교에 넣기`} />
                    </td>
                    <td className="vt-name">
                      <span>{v.name}</span>
                      {fixed && <em className="vt-tag" title={`${berthById[fixed.bid]?.label ?? fixed.bid} ${fmt(fixed.etb)} 고정`}>고정</em>}
                    </td>
                    <td className={`vt-eta ${changed ? 'changed' : ''}`} onClick={(e) => e.stopPropagation()}>
                      <DateTimeField value={v.eta} bad={v.eta == null} label={`${v.name} ETA`} onChange={(t) => setEta(v.id, t)} />
                      {changed && <button type="button" className="vt-undo" title={`원래 ETA ${fmt(etaOf(v))}로`} aria-label="원래 ETA로" onClick={() => setEta(v.id, toInput(etaOf(v)))}><Icon icon="undo" size={13} /></button>}
                    </td>
                  </tr>
                )
              })}
              {!vessels.length && <tr><td colSpan={3} className="vt-empty">「{query}」에 맞는 선박이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="vt-side">
        {showCompare
          ? <VesselCompare pair={pair} rawOf={rawOf} etaOf={etaOf} onClose={() => setComparing(false)} onClear={() => { setPicked([]); setComparing(false) }} />
          : open && <VesselDetail v={open} rawOf={rawOf} etaOf={etaOf} picked={picked.includes(open.id)} onPick={() => togglePick(open.id)} />}
      </section>
    </div>
  )
}

/** 상세와 비교가 같은 칸을 쓴다. 묶음(제원, 화물, 입항, 계약 조건)마다 [이름, 값, 덧말] */
function vesselGroups(v, rawOf, etaOf) {
  const raw = rawOf(v) ?? {}
  const eta0 = etaOf(v)
  return [
    { title: '제원', rows: [
      ['선종', v.cls ?? '-'],
      ['DWT', v.dwt != null ? `${v.dwt.toLocaleString()} t` : '-'],
      ['GRT', v.grt != null ? `${v.grt.toLocaleString()} t` : '-'],
      ['흘수', v.draft != null ? `${v.draft} m` : '-'],
      ['LOA', v.loa != null ? `${v.loa} m` : '-'],
      ['호출부호', v.callSign],
    ] },
    { title: '화물', rows: [
      ['제품', v.product],
      ['입출', v.dir],
      ['물량', `${v.ton.toLocaleString()} t`],
    ] },
    { title: '입항', rows: [
      ['ETA', v.eta != null ? fmtFull(v.eta) : '-', eta0 != null && v.eta !== eta0 ? `원래 ${fmtFull(eta0)}` : null],
    ] },
    { title: '계약 조건', lock: true, rows: [
      ['허용 시간', `${v.contract.laytimeH} h`],
      ['일 체선료', `$${v.contract.rateUsd.toLocaleString()}`],
      ['LayCan', v.laycan ? `${fmt(v.laycan.from)} ~ ${fmt(v.laycan.to)}` : '없음'],
      ['NOR 뒤 개시', raw.notice_hours != null ? `${raw.notice_hours} h` : '6 h (기본)'],
      ['기상 공제', raw.weather_deduct_pct != null ? `${raw.weather_deduct_pct}%` : '50% (기본)'],
      ['CFR', v.contract.cfr ? 'CFR' : '아님'],
    ] },
  ]
}

function VesselDetail({ v, rawOf, etaOf, picked, onPick }) {
  return (
    <div className="vd2">
      <header className="vd2-head">
        <h3>{v.name}</h3>
        <Button className="vd2-pick" icon={picked ? 'tick' : 'add'} active={picked} onClick={onPick}>{picked ? '비교에 넣음' : '비교에 넣기'}</Button>
      </header>
      <div className="vd2-body">
        {vesselGroups(v, rawOf, etaOf).map((g) => (
          <table key={g.title} className={`vd2-grid ${g.lock ? 'locked' : ''}`}>
            <caption>{g.title}{g.lock && <Icon icon="lock" size={12} />}</caption>
            <tbody>
              {g.rows.map(([k, val, note]) => (
                <tr key={k}><th>{k}</th><td>{val}{note && <small>{note}</small>}</td></tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  )
}

function VesselCompare({ pair, rawOf, etaOf, onClose, onClear }) {
  const [a, b] = pair
  const ga = vesselGroups(a, rawOf, etaOf), gb = vesselGroups(b, rawOf, etaOf)
  return (
    <div className="vd2 vc2">
      <header className="vd2-head">
        <h3>두 척 비교</h3>
        <div className="vc2-actions">
          <Button icon="cross" onClick={onClear}>선택 지우기</Button>
          <Button icon="arrow-left" onClick={onClose}>상세로</Button>
        </div>
      </header>
      <div className="vd2-body">
        <table className="vc2-table">
          <colgroup><col className="vc2-k" /><col /><col /></colgroup>
          <thead><tr><th /><th>{a.name}</th><th>{b.name}</th></tr></thead>
          {ga.map((g, gi) => (
            <tbody key={g.title}>
              <tr className="vc2-group"><th colSpan={3}>{g.title}{g.lock && <Icon icon="lock" size={12} />}</th></tr>
              {g.rows.map(([k, va], ri) => {
                const vb = gb[gi].rows[ri][1]
                return <tr key={k} className={va !== vb ? 'diff' : ''}><th>{k}</th><td>{va}</td><td>{vb}</td></tr>
              })}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  )
}

/**
 * 계획 기간 풍속 선 그래프. 11-26 부두 묶음별 하역 중단 풍속(주황 점선)과 이안 기준 풍속(빨강 점선, 엔진 접안 불가 기준)을 함께 그린다.
 * 계획용으로 낮춘 기준(plan)이 있으면 그 띠도.
 */
function WindChart({ wind, win, plan = WIND_LIMIT, stop = WIND_LIMIT, groups = [] }) {
  if (!wind.length) return <p className="small muted">관측값 없음</p>
  const W = 900, H = 220, L = 30, R = 8, T = 14, B = 24
  const lines = groups.flatMap((g, gi) => [
    { v: g.stop, cls: 'stop', text: `${g.label} 하역 중단 ${g.stop}`, side: gi },
    { v: g.leave, cls: 'leave', text: `${g.label} 이안 ${g.leave}`, side: gi },
  ])
  const top = Math.max(stop + 2, ...lines.map((l) => l.v + 2), ...wind.map((w) => w.ms))
  const x = (t) => L + ((t - win.start) / Math.max(1, win.end - win.start)) * (W - L - R)
  const y = (ms) => T + (1 - ms / top) * (H - T - B)
  const path = wind.map((w, i) => `${i ? 'L' : 'M'}${x(w.t).toFixed(1)},${y(w.ms).toFixed(1)}`).join(' ')
  // KST 0시 눈금 (기준 T = 09:00 KST이므로 0시는 T + 15시간 + 24시간 × n)
  const days = []
  for (let t = win.start + (((15 * 60 - win.start) % 1440) + 1440) % 1440; t <= win.end; t += 1440) days.push(t)
  return (
    <svg className="pi-wind" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`풍속 그래프, 최대 ${Math.max(...wind.map((w) => w.ms))} m/s`}>
      {[0, 5, 10, 15, 20].filter((v) => v < top).map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="pi-wind-grid" /><text x={L - 4} y={y(v) + 3} className="pi-wind-tick" textAnchor="end">{v}</text></g>)}
      {days.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={T} y2={H - B} className="pi-wind-grid" /><text x={x(t) + 3} y={H - 5} className="pi-wind-tick">{fmt(t).slice(0, 5)}</text></g>)}
      {lines.map((l) => <line key={l.text} x1={L} x2={W - R} y1={y(l.v)} y2={y(l.v)} className={`pi-wind-th ${l.cls}`} />)}
      {/* 이름은 선을 다 그린 뒤 위에(바탕색 테두리로 선을 가림). 겹치지 않게 첫 묶음은 오른쪽, 둘째 묶음은 왼쪽에 */}
      {lines.map((l) => {
        const label = `${l.text} m/s`
        const w = [...label].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2000 ? 11 : 6.2), 0) + 6 // 글자 폭 어림 (11px 글꼴)
        const x0 = l.side ? L + 2 : W - R - w
        return (
          <g key={l.text}>
            <rect x={x0} y={y(l.v) - 15} width={w} height={14} className="pi-wind-label-bg" />
            <text x={l.side ? L + 5 : W - R - 3} y={y(l.v) - 4} className={`pi-wind-tick th ${l.cls}`} textAnchor={l.side ? 'start' : 'end'}>{label}</text>
          </g>
        )
      })}
      {plan < stop && <>
        <rect x={L} y={y(stop)} width={W - R - L} height={y(plan) - y(stop)} className="pi-wind-margin" />
        <line x1={L} x2={W - R} y1={y(plan)} y2={y(plan)} className="pi-wind-plan" />
        <text x={W - R} y={y(plan) + 12} className="pi-wind-tick plan" textAnchor="end">계획 기준 {plan} m/s</text>
      </>}
      <path d={path} className="pi-wind-line" />
      {wind.filter((w) => w.thunder || w.typhoon).map((w) => <circle key={w.t} cx={x(w.t)} cy={y(w.ms)} r={2.5} className="pi-wind-alert" />)}
    </svg>
  )
}

/** 11-25 받은 메일의 조건 변경 요청: 여기서 바로 반영하거나 반영하지 않기로 정한다. 반영하면 계획 조건에 들어가고, 후보는 「다시 계산」해야 바뀐다 */
/**
 * 11-26 받은 메일의 조건 변경: 체크리스트로 반영할 메일을 고르고, 화면 위 「후보 비교」를 누르면 한꺼번에 결정한다
 *   (체크한 것 반영 · 나머지 반영 안 함 → 바뀐 조건으로 후보를 다시 계산하고 후보 비교로). 결정 뒤에는 「결정 되돌리기」.
 *   메일을 누르면 원본이 팝업으로 뜬다.
 */
function MailChanges({ scen, pick, setPick }) {
  const { isScheduler, pendingIncs, mailDecision, undoMailDecision } = useApp()
  const { alerts } = useInbox()
  const rows = alerts.filter((a) => a.channel === 'incident' && a.incId)
  const [reading, setReading] = useState(null)
  if (!rows.length) return null
  const pendingIds = new Set(pendingIncs.map((i) => i.id))
  return (
    <section className="pi-mail" data-tour="mail-changes">
      <header className="pi-mail-head">
        <Icon icon="envelope" size={14} />
        <b>받은 메일의 조건 변경</b>
        <span className={pendingIds.size ? 'c-amber' : 'c-green'}>{pendingIds.size ? `반영할 메일을 체크하십시오 · 정하지 않은 메일 ${pendingIds.size}건 · 「후보 비교」를 누르면 한꺼번에 정합니다` : '모두 정함'}</span>
        <span className="pi-mail-btns">
          {mailDecision && <Button size="small" variant="minimal" icon="undo" disabled={!isScheduler} onClick={undoMailDecision}>결정 되돌리기</Button>}
        </span>
      </header>
      <ul>
        {rows.map((a) => {
          const inc = scen.incidents.find((i) => i.id === a.incId)
          const open = pendingIds.has(a.incId)
          return (
            <li key={a.id} className={open ? (pick[a.incId] ? 'picked' : '') : a.status}>
              <span className="pi-mail-check">
                {open
                  ? <Checkbox checked={Boolean(pick[a.incId])} disabled={!isScheduler || !inc?.change} aria-label={`${inc?.kind ?? ''} 반영`}
                    onChange={(e) => { const on = e.currentTarget.checked; setPick((p) => ({ ...p, [a.incId]: on })) }} />
                  : a.status === 'applied' ? <St tone="ok">반영함</St> : <St tone="idle">반영 안 함</St>}
              </span>
              <span className="pi-mail-kind">{inc?.kind ?? '변경'}</span>
              <button type="button" className="pi-mail-body" onClick={() => setReading(a)} title="메일 원본 보기">
                <b>{inc ? changeText(scen, inc) : a.title}</b>
                <small>{a.from} · {a.at}</small>
              </button>
            </li>
          )
        })}
      </ul>
      <Dialog isOpen={Boolean(reading)} onClose={() => setReading(null)} title={reading?.subject} icon="envelope" className="pi-mail-dialog">
        {reading && (
          <DialogBody>
            <div className="ml-paper">
              <dl className="ml-head">
                <dt>보낸 사람</dt><dd>{reading.from} &lt;{reading.fromAddr}&gt;</dd>
                <dt>받은 시각</dt><dd className="num">{reading.at}</dd>
                <dt>제목</dt><dd className="strong">{reading.subject}</dd>
              </dl>
              <pre className="ml-preview">{reading.body}</pre>
            </div>
          </DialogBody>
        )}
      </Dialog>
    </section>
  )
}
