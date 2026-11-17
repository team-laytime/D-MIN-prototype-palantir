// 보고서 공용 도우미. 문서 본문은 candidateReport.js가 만든다.
import { fmt } from './time.js'

export function reportPeriod(cand) {
  const ps = cand.placements
  return `${fmt(Math.min(...ps.map((p) => p.etb))).slice(0, 5)} ~ ${fmt(Math.max(...ps.map((p) => p.etu))).slice(0, 5)}`
}
