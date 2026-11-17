// 보고서 화면과 메일 작성 화면이 같은 후보·판단근거로 같은 문서를 보게 하는 훅.
import { useMemo } from 'react'
import { useApp } from './app.jsx'
import { buildCandidateReport, candidateMailDraft, candidateReportMarkdown } from '../lib/candidateReport.js'
import { money } from '../lib/time.js'

export function useReport() {
  const { result, scen, focusId, current, version, reportDraft } = useApp()
  const cands = result.candidates
  const plan = current?.version === version ? current : null
  // 입력이 바뀌어 후보 수가 줄면 예전에 고른 id가 없을 수 있어 후보 목록 안에서만 받아들인다.
  const valid = (id) => (id && cands.some((c) => c.id === id) ? id : null)
  const selId = valid(reportDraft.selId) ?? valid(plan?.candId) ?? valid(focusId) ?? cands[0].id
  const shownPlan = plan && plan.candId === selId ? plan : null
  // 아직 손대지 않았으면(null) 확정 때 남긴 판단근거를 보여 준다.
  const judgment = reportDraft.judgment ?? shownPlan?.reason ?? ''

  const model = useMemo(
    () => buildCandidateReport({ result, scen, selId, judgment, plan: shownPlan }),
    [result, scen, selId, judgment, shownPlan],
  )
  const md = useMemo(() => candidateReportMarkdown(model), [model])
  const mail = useMemo(() => candidateMailDraft(model), [model])

  // 문서·메일 속 금액이 전부 계산 결과에서 나왔는지 대조한다.
  // 판단근거는 사람이 쓴 문장이라 뺀다(후보 간 차액처럼 계산에 없는 금액을 적을 수 있다).
  const check = useMemo(() => {
    const allowed = new Set()
    for (const sim of [result.fcfs, ...cands]) {
      for (const c of [sim.total, sim.total - result.fcfs.total, result.fcfs.total - sim.total]) allowed.add(money(c))
      for (const p of sim.placements) allowed.add(money(p.dem.cents))
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
