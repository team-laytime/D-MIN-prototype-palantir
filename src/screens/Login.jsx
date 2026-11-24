// 시연용 로그인. 실제 인증이 아니라 화면에 적힌 시연 계정과 맞는지만 본다. 로그인한 계정이 곧 역할이다.
import { useRef, useState } from 'react'
import { Button, Callout, FormGroup, HTMLSelect, InputGroup } from '@blueprintjs/core'
import { PASSWORD, ROLES } from '../lib/workspace.js'
import { useApp } from '../state/app.jsx'
import { Brand, ThemeToggle } from '../ui/Shell.jsx'
import './login.css'

export default function Login() {
  const { login, scen } = useApp()
  // 11-20 피드백: 역할을 고르는 카드를 없앴다. 들어온 아이디가 곧 역할이다.
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const pwEl = useRef(null)
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'sent'
  const submit = (e) => {
    e.preventDefault()
    const r = Object.values(ROLES).find((x) => x.loginId === id.trim())
    if (r && pw === PASSWORD) login(r.id)
    else setErr('아이디 또는 비밀번호가 맞지 않습니다. 시연 계정 비밀번호는 1234입니다.')
  }

  return (
    <div className="login-page">
      <div className="login-theme"><ThemeToggle /></div>
      <div className="login-intro">
        <Brand size={22} />
        <h1>울산 SK 액체부두<br />접안 계획 · 체선료 최적화</h1>
        <p className="muted">실제 접안 실적 데이터로 팀 최적화 엔진(CP-SAT)이 만든 접안 계획 후보 3개를 비교하고(체선료가 가장 낮은 안이 기본 선택), 남은 리스크를 확인한 뒤 확정합니다.</p>
        <dl className="login-facts mono">
          <div><dt>BERTHS</dt><dd>{scen ? `${scen.berths.length} (SK1~8, BUOY, GAS)` : '-'}</dd></div>
          <div><dt>VESSELS</dt><dd>{scen ? `${scen.vessels.length} / ${scen.days * 24}H` : '-'}</dd></div>
          <div><dt>ENGINE</dt><dd>CP-SAT · {scen ? scen.presets.length : 3} PRESETS</dd></div>
          <div><dt>DATA</dt><dd className="c-amber">{scen ? `${scen.bundle} (계약은 가상)` : '불러오는 중'}</dd></div>
        </dl>
      </div>

      {mode === 'login' ? (
      <form className="login-card panel" onSubmit={submit} aria-labelledby="login-title">
        <header className="panel-head">
          <span className="panel-code">AUTH</span>
          <h2 className="panel-title" id="login-title">로그인</h2>
          <span className="panel-desc">아이디에 따라 보이는 메뉴가 정해집니다</span>
        </header>
        <div className="panel-body pad">
          <FormGroup label="아이디" labelFor="login-id">
            <InputGroup id="login-id" value={id} autoFocus placeholder="사번 또는 아이디" onChange={(e) => setId(e.target.value)} autoComplete="username" />
          </FormGroup>
          <FormGroup label="비밀번호" labelFor="login-pw" helperText="시연 계정: scheduler(선박 스케줄러), user(일정 이용자) · 비밀번호 1234 · 실제 인증 아님">
            <InputGroup id="login-pw" type="password" inputRef={pwEl} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </FormGroup>
          {err && <Callout intent="danger" icon="error" compact className="login-err">{err}</Callout>}
          <Button type="submit" intent="primary" fill size="large" text="로그인" endIcon="arrow-right" />
          <p className="login-signup small">계정이 없으면 <button type="button" onClick={() => setMode('signup')}>회원가입 (계정 신청)</button></p>
        </div>
      </form>
      ) : <Signup sent={mode === 'sent'} onSent={() => setMode('sent')} onBack={() => setMode('login')} />}
    </div>
  )
}

/** 11-23 피드백: 회원가입. 사내 시스템이라 바로 쓰는 계정이 아니라 신청 → 관리자 승인 방식으로 둔다(시연: 저장하지 않음). */
function Signup({ sent, onSent, onBack }) {
  const [role, setRole] = useState('user')
  if (sent) {
    return (
      <div className="login-card panel">
        <header className="panel-head"><span className="panel-code">SIGNUP</span><h2 className="panel-title">신청 완료</h2></header>
        <div className="panel-body pad">
          <Callout intent="success" icon="tick-circle" title="계정 신청을 받았습니다">관리자가 소속과 역할을 확인한 뒤 승인하면 메일로 알려 드립니다. 승인 전에는 로그인할 수 없습니다.</Callout>
          <Button fill style={{ marginTop: 14 }} icon="arrow-left" text="로그인으로" onClick={onBack} />
        </div>
      </div>
    )
  }
  return (
    <form className="login-card panel" onSubmit={(e) => { e.preventDefault(); onSent() }}>
      <header className="panel-head"><span className="panel-code">SIGNUP</span><h2 className="panel-title">회원가입 (계정 신청)</h2><span className="panel-desc">관리자 승인 뒤 사용</span></header>
      <div className="panel-body pad login-signup-form">
        <div className="login-2col">
          <FormGroup label="이름 *"><InputGroup required placeholder="홍길동" /></FormGroup>
          <FormGroup label="사번 *"><InputGroup required placeholder="SK00000" /></FormGroup>
        </div>
        <FormGroup label="회사 메일 *"><InputGroup required type="email" placeholder="name@example.com" /></FormGroup>
        <div className="login-2col">
          <FormGroup label="요청 역할 *"><HTMLSelect fill value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: 'scheduler', label: '선박 스케줄러' }, { value: 'user', label: '일정 이용자' }]} /></FormGroup>
          <FormGroup label={role === 'user' ? '담당 부두 · 팀 *' : '소속 팀 *'}><HTMLSelect fill options={role === 'user' ? ['SK 3부두 하역 1팀', 'SK 5부두 하역 1팀', 'SK 6부두 하역 2팀', '선박 대리점'] : ['물류운영팀 선박 스케줄']} /></FormGroup>
        </div>
        <div className="login-2col">
          <FormGroup label="비밀번호 *"><InputGroup required type="password" /></FormGroup>
          <FormGroup label="비밀번호 확인 *"><InputGroup required type="password" /></FormGroup>
        </div>
        <p className="tiny muted">* 필수 · 역할에 따라 보이는 메뉴가 다릅니다. 스케줄러 권한은 팀장 승인이 필요합니다.</p>
        <div className="login-2col">
          <Button icon="arrow-left" text="로그인으로" onClick={onBack} />
          <Button type="submit" intent="primary" text="신청하기" endIcon="send-message" />
        </div>
      </div>
    </form>
  )
}
