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
import Schedule from './screens/Schedule.jsx'
import VesselDrawer from './screens/VesselDrawer.jsx'
import Tour from './screens/Tour.jsx'

// 후보 계산이 필요한 화면만 막는다. 확정 일정은 확정 당시 스냅숏이라 계산 실패와 상관없이 열린다.
const NEEDS_RESULT = ['home', 'compare', 'risk', 'report']

export default function App() {
  const { role, tab, result, resetKey, drawer, drawerSim, tour } = useApp()
  if (!role) return <Login />
  let screen
  if (NEEDS_RESULT.includes(tab) && result.error) {
    screen = <div className="screen-body"><Callout intent="danger" icon="error" title="후보 계산 불가">{result.error}</Callout></div>
  } else {
    screen = {
      home: <Home key={resetKey} />,
      input: <ScenarioInput />,
      compare: <Compare />,
      risk: <Risk />,
      report: <Report />,
      verify: <Verify />,
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
