import { useEffect, useId, useState } from 'react'
import { Button, Checkbox } from '@blueprintjs/core'
import { checksForConstraint, searchPrecedents } from '../lib/precedent.js'
import { precedentConfirmation, precedentQuery } from '../lib/precedentComparison.js'
import { money } from '../lib/time.js'
import { Panel } from '../ui/kit.jsx'
import './similar.css'

const DECISION = { select: '모의 선택', hold: '보류', recalculate: '재계산' }
const EMPTY_TEXT = {
  action_unconfirmed: '현재 계획에서 이 조치를 적용할 수 있는지 확인하면 사례를 볼 수 있습니다.',
  no_match: '현재 조건과 적용 가능한 조치가 맞는 사례가 없습니다.',
  missing_query_context: '검색에 필요한 제약 정보가 부족합니다.',
}

function describeValue(value, unit) {
  return typeof value === 'number' ? `${value.toLocaleString('ko-KR')}${unit ?? ''}` : value
}

export default function SimilarCases({ context, reference, onReference, blocked }) {
  const selectId = useId()
  const [resource, setResource] = useState({ status: 'loading', index: null })
  const [choice, setChoice] = useState('')
  const [diagnosis, setDiagnosis] = useState(false)
  const [confirmedOption, setConfirmedOption] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}data/precedent-index.json`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('사례 데이터 없음')
        const index = await response.json()
        if (index.formatVersion !== 1 || !Array.isArray(index.cases)) throw new Error('사례 데이터 형식 오류')
        if (!controller.signal.aborted) setResource({ status: 'ready', index })
      })
      .catch(() => { if (!controller.signal.aborted) setResource({ status: 'unavailable', index: null }) })
    return () => controller.abort()
  }, [])

  const option = context.options.find((entry) => entry.id === choice) ?? context.options[0]
  const intent = diagnosis ? 'diagnosis' : option?.intent
  const confirmation = option && precedentConfirmation(context, option, intent)
  const confirmed = Boolean(confirmation && confirmedOption === option.id)
  const currentChecks = !blocked ? checksForConstraint(option?.constraint) : []
  const query = option ? precedentQuery(context, option, intent, confirmed) : null
  const result = !blocked && resource.index && query ? searchPrecedents(resource.index, query) : null
  const message = blocked ? '후보를 다시 계산한 뒤 사례를 비교할 수 있습니다.'
    : resource.status === 'loading' ? '사례를 불러오는 중입니다.'
      : resource.status === 'unavailable' ? '이 환경에서 사례 데이터가 준비되지 않았습니다.'
        : !option ? '현재 계획에서 비교할 제약이나 리스크를 찾지 못했습니다.'
          : EMPTY_TEXT[result?.status]

  return (
    <Panel code="PRECEDENT" title="유사 과거 사례" pad className="sc">
      <p className="sc-sub">실적을 바탕으로 재현한 AI 모의 판단</p>
      {option && !blocked && (
        <div className="sc-now">
          {context.options.length === 1 && !onReference ? <b>{option.label}</b> : <>
            <label className="sc-label" htmlFor={selectId}>비교할 조건</label>
            <div className="bp6-html-select">
              <select id={selectId} value={option.id} onChange={(event) => {
                setChoice(event.target.value); setDiagnosis(false); setConfirmedOption(null); onReference?.(null)
              }}>
                {context.options.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </div>
          </>}
          {option.intent === 'selection' && <Checkbox checked={diagnosis}
            onChange={(event) => { setDiagnosis(event.target.checked); setConfirmedOption(null); onReference?.(null) }}>보류·재계산 근거 보기</Checkbox>}
          {confirmation && <Checkbox checked={confirmed}
            onChange={(event) => { setConfirmedOption(event.target.checked ? option.id : null); onReference?.(null) }}>{confirmation}</Checkbox>}
        </div>
      )}
      {currentChecks.length > 0 && <p className="sc-current-checks"><b>이번 확인</b> {currentChecks.join(' ')}</p>}
      {message && <p className="sc-message" role="status">{message}</p>}
      {result?.matches.length > 0 && (
        <ul className="sc-list">
          {result.matches.map((card) => {
            const attached = reference?.caseId === card.caseId
            const actionChecks = card.currentChecks.filter((check) => !currentChecks.includes(check))
            return (
              <li className="sc-case" key={card.caseId}>
                <b className="sc-title"><span className="num">{card.asOf.slice(0, 10)}</span> {card.title}</b>
                <p><b>일치</b> {card.common.join(', ')}</p>
                <p><b>차이</b> {card.differences.length ? card.differences.map((diff) => (
                  `${diff.label} ${describeValue(diff.precedent, diff.unit)} → 현재 ${describeValue(diff.current, diff.unit)}`
                )).join(', ') : '비교 항목의 수치가 같습니다.'}</p>
                <p><b>당시 판단</b> {DECISION[card.decision]}{card.selected ? ` ${card.selected.slot}안 (${money(card.selected.expected_demurrage_cents)})` : ''} {card.reasoning}</p>
                {actionChecks.length > 0 && <p><b>조치 전 확인</b> {actionChecks.join(' ')}</p>}
                {onReference && <div><Button size="small" active={attached} onClick={() => onReference(attached ? null : {
                  caseId: card.caseId, caseGroupId: card.caseGroupId, title: card.title, asOf: card.asOf, provenance: card.provenance,
                  historicalSelection: card.selected ?? null, sourceEvidence: card.evidence,
                  decision: card.decision, comparisonConstraint: option.constraint, capabilities: query.capabilities,
                  currentRiskId: option.risk?.id ?? null, currentRiskSlot: option.risk ? option.id.split(':')[0] : null,
                  common: card.common, differences: card.differences, currentChecks: card.currentChecks,
                })}>{attached ? '참고 취소' : '판단 기록에 참고'}</Button></div>}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
