// 보고서(체선료 지불 부서 메일 첨부)와 메일 작성 화면이 같은 후보, 판단근거로 같은 문서를 보게 하는 훅.
import { useMemo } from 'react'
import { useApp } from './app.jsx'
import { buildCandidateReport, candidateMailDraft, candidateReportMarkdown } from '../lib/candidateReport.js'
import { changedVs } from '../lib/plan.js'
import { money } from '../lib/time.js'

export function useReport() {
  const { result, scen, focusId, current, version, reportDraft } = useApp()
  const cands = result.candidates
  const ready = Boolean(scen && cands.length)
  const plan = current?.version === version ? current : null
  // 다시 계산해 후보가 바뀌면 예전에 고른 id가 없을 수 있어 후보 목록 안에서만 받아들인다.
  const valid = (id) => (id && cands.some((c) => c.id === id) ? id : null)
  const selId = ready ? valid(reportDraft.selId) ?? valid(plan?.candId) ?? valid(focusId) ?? cands[0].id : null
  const shownPlan = plan && plan.candId === selId ? plan : null
  // 아직 손대지 않았으면(null) 확정 때 남긴 판단근거를 보여 준다.
  const judgment = reportDraft.judgment ?? shownPlan?.reason ?? ''

  const model = useMemo(
    () => (ready ? buildCandidateReport({ result, scen, selId, judgment, plan: shownPlan }) : null),
    [ready, result, scen, selId, judgment, shownPlan],
  )
  const md = useMemo(() => (model ? candidateReportMarkdown(model) : ''), [model])
  const mail = useMemo(() => (model ? candidateMailDraft(model) : { subject: '', body: '' }), [model])

  // 문서와 메일 속 금액이 전부 엔진 결과(또는 엔진 값끼리의 차액)에서 나왔는지 대조한다.
  // 판단근거는 사람이 쓴 문장이라 뺀다.
  const check = useMemo(() => {
    if (!model) return { count: 0, bad: [] }
    const allowed = new Set()
    const add = (c) => { allowed.add(money(c)); allowed.add(money(Math.abs(c))) }
    const base = result.baseline
    if (base) { add(base.total); for (const p of base.placements) add(p.dem.cents) }
    for (const sim of cands) {
      add(sim.total); add(sim.total - cands[0].total)
      if (base) { add(base.total - sim.total); for (const c of changedVs(sim, base)) add(c.saving) }
      for (const p of sim.placements) add(p.dem.cents)
    }
    const generated = { ...model, judgment: '' }
    const g = candidateMailDraft(generated)
    const found = [...(candidateReportMarkdown(generated) + g.subject + g.body).matchAll(/-?\$[\d,]+\.\d{2}/g)].map((x) => x[0])
    return { count: found.length, bad: found.filter((a) => !allowed.has(a)) }
  }, [model, result, cands])

  return { model, md, mail, check, plan, shownPlan, selId, judgment }
}

/** 보고서 마크다운 파일 내려받기. */
export function downloadMarkdown(md, selId) {
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = reportFileName(selId)
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const reportFileName = (selId) => `접안계획_후보안비교_${selId}.md`
