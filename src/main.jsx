import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 11-25 폰트: 기업용 솔루션 느낌의 IBM Plex 한 벌(한글 본문 Sans KR + 숫자, 코드 Mono)
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/500.css'
import '@fontsource/ibm-plex-sans-kr/600.css'
import '@fontsource/ibm-plex-sans-kr/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@blueprintjs/core/lib/css/blueprint.css'
import '@blueprintjs/icons/lib/css/blueprint-icons.css'
import 'leaflet/dist/leaflet.css'
import './theme.css'
import './ui/shell.css'
import './state/theme.js'
import App from './App.jsx'
import { AppProvider } from './state/app.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
