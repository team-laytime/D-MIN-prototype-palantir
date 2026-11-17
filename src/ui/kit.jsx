// 화면들이 같이 쓰는 뼈대. 스타일은 theme.css의 .panel / .stats / .screen / .steps.
import { itemOf, groupOf } from '../lib/workspace.js'

/** 패널: code는 영문 짧은 식별자(예: 'CAND-COST'), title은 한국어 제목. */
export function Panel({ code, title, desc, actions, pad = false, className = '', bodyClass = '', style, children, ...rest }) {
  return (
    <section className={`panel ${className}`} style={style} {...rest}>
      {(code || title || actions) && (
        <header className="panel-head">
          {code && <span className="panel-code">{code}</span>}
          {title && <h2 className="panel-title">{title}</h2>}
          {desc && <span className="panel-desc">{desc}</span>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className={`panel-body ${pad ? 'pad' : ''} ${bodyClass}`}>{children}</div>
    </section>
  )
}

/** 요약 수치 한 줄. items = [{label, value, sub, tone}] tone: 'accent'|'amber'|'red'|'green'|'violet' */
export function Stats({ items, className = '' }) {
  return (
    <div className={`stats ${className}`}>
      {items.map((s) => (
        <div className="stat" key={s.label}>
          <div className="stat-label">{s.label}</div>
          <div className={`stat-value ${s.tone ? `c-${s.tone}` : ''}`}>{s.value}</div>
          {s.sub && <div className="stat-sub">{s.sub}</div>}
        </div>
      ))}
    </div>
  )
}

const PLAN_STEPS = ['입력 확인', '후보 비교', '리스크 확인', '계획 확정', '보고서 작성']
/** 계획 흐름 단계. now = 1..5 */
export function Steps({ now }) {
  return (
    <div className="steps" aria-label="계획 흐름">
      {PLAN_STEPS.map((s, i) => (
        <span key={s} className={i + 1 === now ? 'on' : i + 1 < now ? 'done' : ''}>
          <b>{String(i + 1).padStart(2, '0')}</b>{s}
        </span>
      ))}
    </div>
  )
}

/** 화면 틀: 머리(경로 · 제목 · 설명 · 단계 · 동작) + 스크롤되는 본문. */
export function Screen({ tab, title, desc, step, actions, bodyClass = '', children }) {
  const g = groupOf(tab)
  const item = itemOf(tab)
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <div className="screen-path">{g?.key} / {g?.code}-{tab.toUpperCase()}</div>
          <h1 className="screen-title">{title ?? item?.label}</h1>
        </div>
        {desc && <p className="screen-desc">{desc}</p>}
        {step && <Steps now={step} />}
        {actions && <div className="screen-actions">{actions}</div>}
      </div>
      <div className={`screen-body ${bodyClass}`}>{children}</div>
    </div>
  )
}

/** 상태 점 표시. tone: ok | warn | bad | unknown | idle | live */
export const St = ({ tone, children, className = '' }) => <span className={`st ${tone} ${className}`}>{children}</span>

/** 리스크 판정 → 톤 */
export const riskTone = (state) => (state === '해당' ? 'warn' : state === '판단 불가' ? 'unknown' : 'ok')
