import { Callout } from '@blueprintjs/core'
import { useApp } from './state/app.jsx'
import { Shell } from './ui/Shell.jsx'
import Login from './screens/Login.jsx'
import Home from './screens/Home.jsx'
import ScenarioInput from './screens/ScenarioInput.jsx'
import Compare from './screens/Compare.jsx'
import Risk from './screens/Risk.jsx'
import Report from './screens/Report.jsx'
import Verify from './screens/Verify.jsx'
import Mail from './screens/Mail.jsx'
import Inbox from './screens/Inbox.jsx'
import Activity from './screens/Activity.jsx'
import Schedule from './screens/Schedule.jsx'
import VesselDrawer from './screens/VesselDrawer.jsx'
import Tour from './screens/Tour.jsx'

// 후보 계산이 필요한 화면만 막는다. 확정 일정은 확정 당시 스냅숏이라 계산 실패와 상관없이 열린다.
const NEEDS_RESULT = ['home', 'compare', 'risk', 'report', 'mail']
// 보고서·메일은 후보 중 하나를 고르는 화면이라, 기준안보다 나은 후보가 하나도 없으면 열 수 없다.
const NEEDS_CANDIDATE = ['report', 'mail']

export default function App() {
  const { role, tab, result, resetKey, drawer, drawerSim, tour } = useApp()
  if (!role) return <Login />
  let screen
  if (NEEDS_RESULT.includes(tab) && result.error) {
    screen = <div className="screen-body"><Callout intent="danger" icon="error" title="후보 계산 불가">{result.error}</Callout></div>
  } else if (NEEDS_CANDIDATE.includes(tab) && !result.candidates.length) {
    screen = <div className="screen-body"><Callout intent="warning" icon="info-sign" title="보고할 후보 없음">지금 입력으로는 도착순 기준안보다 체선료가 낮은 후보가 없습니다. 「시나리오 입력」에서 조건을 확인하거나, 기준안으로 진행하십시오.</Callout></div>
  } else {
    screen = {
      home: <Home key={resetKey} />,
      input: <ScenarioInput />,
      compare: <Compare />,
      risk: <Risk />,
      report: <Report />,
      verify: <Verify />,
      mail: <Mail />,
      inbox: <Inbox />,
      activity: <Activity />,
      ops: <Schedule />,
    }[tab]
  }
  return (
    <>
      <Shell>{screen}</Shell>
      {drawer && drawerSim && <VesselDrawer key={`${drawer.simId}-${drawer.vid}-${drawer.mode}`} />}
      {tour.index !== null && <Tour />}
    </>
  )
}
