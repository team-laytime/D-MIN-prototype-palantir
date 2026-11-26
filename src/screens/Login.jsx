// 시연용 로그인. 실제 인증이 아니라 화면에 적힌 시연 계정과 맞는지만 본다. 로그인한 계정이 곧 역할이다.
import { useEffect, useRef, useState } from 'react'
import { Button, Callout, FormGroup, Icon, InputGroup } from '@blueprintjs/core'
import { ADMIN_LOGIN_ID, PASSWORD, ROLES } from '../lib/workspace.js'
import { useApp } from '../state/app.jsx'
import { suspendFontZoom } from '../state/theme.js'
import './login.css'

export default function Login() {
  const { login } = useApp()
  useEffect(() => suspendFontZoom(), [])
  // 11-20 피드백: 역할을 고르는 카드를 없앴다. 들어온 아이디가 곧 역할이다.
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const pwEl = useRef(null)
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'sent'
  const submit = (e) => {
    e.preventDefault()
    // 시스템 관리자는 업무 화면이 아니라 관리자 화면(?view=admin)으로 보낸다
    if (id.trim() === ADMIN_LOGIN_ID && pw === PASSWORD) {
      const url = new URL(window.location.href); url.searchParams.set('view', 'admin'); window.location.assign(url); return
    }
    const r = Object.values(ROLES).find((x) => x.loginId === id.trim())
    if (r && pw === PASSWORD) login(r.id)
    else setErr('아이디 또는 비밀번호가 맞지 않습니다.')
  }

  return (
    <div className="login-page">
      <main className="login-stage">
      <div className={`login-side${mode === 'login' ? '' : ' is-signup'}`}>
        <div className="login-logo">
          <img src="/brand/dmin-logo.png" alt="" width="44" height="44" />
          <span className="login-word">D-MIN</span>
        </div>
      {mode === 'login' ? (
      <form className="login-card login-main panel" onSubmit={submit} aria-labelledby="login-title">
        <header className="panel-head">
          <h2 className="panel-title" id="login-title">로그인</h2>
        </header>
        <div className="panel-body pad">
          <FormGroup label="아이디" labelFor="login-id">
            <InputGroup id="login-id" value={id} autoFocus placeholder="사번 또는 아이디" onChange={(e) => setId(e.target.value)} autoComplete="username" />
          </FormGroup>
          <FormGroup label="비밀번호" labelFor="login-pw">
            <InputGroup id="login-pw" type="password" inputRef={pwEl} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </FormGroup>
          {err && <Callout intent="danger" icon="error" compact className="login-err">{err}</Callout>}
          <Button type="submit" intent="primary" fill size="large" text="로그인" endIcon="arrow-right" />
          <div className="login-alt" aria-hidden="true" />
          <Button className="login-signup-btn" fill size="large" text="회원가입" onClick={() => setMode('signup')} />
        </div>
      </form>
      ) : <Signup sent={mode === 'sent'} onSent={() => setMode('sent')} onBack={() => setMode('login')} />}
      </div>
      </main>
      {/* 11-25 푸터 자리(임시 문구, 이름은 나중에 뺌) */}
      <footer className="login-footer">D-MIN Solution. Made by Minkyu</footer>
    </div>
  )
}

/** 11-23 피드백: 회원가입. 사내 시스템이라 바로 쓰는 계정이 아니라 신청 → 관리자 승인 방식으로 둔다(시연: 저장하지 않음). */
function Signup({ sent, onSent, onBack }) {
  const [role, setRole] = useState('user')
  if (sent) {
    return (
      <div className="login-card login-main panel">
        <header className="panel-head"><h2 className="panel-title">신청 완료</h2></header>
        <div className="panel-body pad">
          <Callout intent="success" icon="tick-circle" title="계정 신청을 받았습니다">관리자가 소속과 역할을 확인한 뒤 승인하면 메일로 알려 드립니다. 승인 전에는 로그인할 수 없습니다.</Callout>
          <Button fill size="large" style={{ marginTop: 24 }} icon="arrow-left" text="로그인으로" onClick={onBack} />
        </div>
      </div>
    )
  }
  const req = <span className="login-req">*</span>
  return (
    <form className="login-card login-main panel" onSubmit={(e) => { e.preventDefault(); onSent() }}>
      <header className="panel-head"><h2 className="panel-title">회원가입 (계정 신청)</h2></header>
      <div className="panel-body pad login-signup-form">
        <div className="login-2col">
          <FormGroup label="이름" labelInfo={req}><InputGroup required placeholder="홍길동" /></FormGroup>
          <FormGroup label="사번" labelInfo={req}><InputGroup required placeholder="SK00000" /></FormGroup>
        </div>
        <FormGroup label="회사 메일" labelInfo={req}><InputGroup required type="email" placeholder="name@example.com" /></FormGroup>
        <FormGroup label="요청 역할" labelInfo={req}>
          <div className="login-role" role="radiogroup" aria-label="요청 역할">
            {[{ value: 'scheduler', label: '선박 스케줄러', icon: 'timeline-events' }, { value: 'user', label: '일정 이용자', icon: 'calendar' }].map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={role === o.value} className={role === o.value ? 'on' : ''} onClick={() => setRole(o.value)}>
                <Icon icon={o.icon} size={16} />
                <span>{o.label}</span>
              </button>
            ))}
          </div>
        </FormGroup>
        <FormGroup label={role === 'user' ? '담당 부두 · 팀' : '소속 팀'} labelInfo={req}>
          <div className="login-select">
            <select key={role} required>
              {(role === 'user' ? ['SK 3부두 하역 1팀', 'SK 5부두 하역 1팀', 'SK 6부두 하역 2팀', '선박 대리점'] : ['물류운영팀 선박 스케줄']).map((t) => <option key={t}>{t}</option>)}
            </select>
            <Icon icon="chevron-down" size={16} />
          </div>
        </FormGroup>
        <div className="login-2col">
          <FormGroup label="비밀번호" labelInfo={req}><InputGroup required type="password" /></FormGroup>
          <FormGroup label="비밀번호 확인" labelInfo={req}><InputGroup required type="password" /></FormGroup>
        </div>
        <div className="login-2col login-actions">
          <Button size="large" icon="arrow-left" text="로그인으로" onClick={onBack} />
          <Button size="large" type="submit" intent="primary" text="신청하기" endIcon="send-message" />
        </div>
      </div>
    </form>
  )
}
