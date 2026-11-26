import { Callout } from '@blueprintjs/core'
import { useApp } from './state/app.jsx'
import { Shell } from './ui/Shell.jsx'
import Login from './screens/Login.jsx'
import Admin from './screens/Admin.jsx'
import Home from './screens/Home.jsx'
import ScenarioInput from './screens/ScenarioInput.jsx'
import Compare from './screens/Compare.jsx'
import Mail from './screens/Mail.jsx'
import Inbox from './screens/Inbox.jsx'
import Activity from './screens/Activity.jsx'
import Schedule from './screens/Schedule.jsx'
import VesselDrawer from './screens/VesselDrawer.jsx'
import Tour from './screens/Tour.jsx'

// 후보 계산이 필요한 화면만 막는다. 확정 일정은 확정 당시 스냅숏이라 계산 실패와 상관없이 열린다.
const NEEDS_RESULT = ['home', 'compare', 'mail']

export default function App() {
  const { role, tab, result, resetKey, drawer, drawerSim, tour } = useApp()
  // 관리자 시연은 별도 주소에서만 연다. 기존 로그인/업무 흐름은 유지한다.
  if (new URLSearchParams(window.location.search).get('view') === 'admin') return <Admin onLogout={() => { const url = new URL(window.location.href); url.searchParams.delete('view'); window.location.assign(url) }} />
  if (!role) return <Login />
  let screen
  if (result.loading && tab !== 'ops') {
    // 11-26 데이터셋 · 기준 시각 하역 속도는 몇 초뿐이라 안내 없이 빈 화면으로 둔다 (BootCallout은 남겨 둠)
    screen = <div className="screen-body" />
  } else if (NEEDS_RESULT.includes(tab) && result.error) {
    screen = <div className="screen-body"><Callout intent="danger" icon="error" title="데이터를 불러오지 못함">{result.error}</Callout></div>
  } else {
    screen = {
      home: <Home key={resetKey} />,
      input: <ScenarioInput />,
      compare: <Compare />,
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
