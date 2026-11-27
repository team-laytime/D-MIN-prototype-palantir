import { useEffect, useState } from 'react'
import { Callout, Spinner } from '@blueprintjs/core'

// 11-26 처음 열 때: 브라우저에 저장된 계산이 없으면 후보 A → B · C를 엔진으로 계산한다(한 번만, 다음부터는 바로 뜸)
export default function BootCallout({ boot }) {
  const [, tick] = useState(0)
  useEffect(() => { if (!boot) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [boot])
  if (!boot) return <Callout icon="cloud-download" title="데이터셋 불러오는 중">데이터셋을 불러오고 있습니다.</Callout>
  const sec = Math.round((Date.now() - boot.since) / 1000)
  if (boot.step === 'rates') {
    return (
      <Callout icon={<Spinner size={16} />} intent="primary" title="기준 시각의 하역 속도 계산 중">
        고른 시각 전에 끝난 과거 하역 실적으로 배 · 부두별 하역 속도를 계산합니다(전처리). <span className="num">{sec}</span>초 · 보통 몇 초, 한 번 계산한 시각은 저장됩니다.
      </Callout>
    )
  }
  return (
    <Callout icon={<Spinner size={16} />} intent="primary" title={boot.step === 'A' ? '후보 A 계산 중 (1/2)'
      : boot.step === 'C' ? '후보 C 계산 중 (2/2)' : '후보 B · C 계산 중 (2/2)'}>
      {boot.step === 'A' ? '기본 계획을 먼저 계산합니다. B는 A 계획의 탱크 재고와 예보 풍속을 보고 고릅니다.'
        : boot.step === 'C' ? 'A에서 계획을 찾지 못했습니다. A에 의존하는 B를 건너뛰고 C를 계산합니다.'
          : 'A로 고른 B와 도착 · 작업 지연 대비 C를 동시에 계산합니다.'}
      {' '}<span className="num">{sec}</span>초 · 단계마다 최대 1분쯤 걸립니다(다른 계산이 돌고 있으면 더). 계산 결과는 이 브라우저에 저장되어 다음부터는 바로 열립니다.
    </Callout>
  )
}
