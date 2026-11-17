// 시연용 로그인. 실제 인증이 아니라 화면에 적힌 시연 계정과 맞는지만 본다. 로그인한 계정이 곧 역할이다.
import { useEffect, useRef, useState } from 'react'
import { Button, Callout, FormGroup, InputGroup } from '@blueprintjs/core'
import { PASSWORD, ROLES } from '../lib/workspace.js'
import { useApp } from '../state/app.jsx'
import { Brand, ThemeToggle } from '../ui/Shell.jsx'
import './login.css'

export default function Login() {
  const { login } = useApp()
  const [pick, setPick] = useState('scheduler')
  const [id, setId] = useState(ROLES.scheduler.loginId)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const pwEl = useRef(null)
  useEffect(() => { pwEl.current?.focus() }, [])

  const choose = (r) => { setPick(r.id); setId(r.loginId); setErr(''); pwEl.current?.focus() }
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
        <h1>울산 CLX 액체부두<br />접안 순서 · 체선료 최적화</h1>
        <p className="muted">도착순 기준안과 5,760가지 접안 순서·부두 배정을 비교해 체선료가 가장 낮은 후보를 고르고, 남은 리스크를 확인한 뒤 확정합니다.</p>
        <dl className="login-facts mono">
          <div><dt>BERTHS</dt><dd>SK3 · SK5 · SK6</dd></div>
          <div><dt>VESSELS</dt><dd>6 / SCENARIO</dd></div>
          <div><dt>SEARCH</dt><dd>720 ORDERS × 8 ASSIGNMENTS</dd></div>
          <div><dt>DATA</dt><dd className="c-amber">가상 데이터 · 시연용</dd></div>
        </dl>
      </div>

      <form className="login-card panel" onSubmit={submit} aria-labelledby="login-title">
        <header className="panel-head">
          <span className="panel-code">AUTH</span>
          <h2 className="panel-title" id="login-title">로그인</h2>
          <span className="panel-desc">계정에 따라 보이는 메뉴가 다릅니다</span>
        </header>
        <div className="panel-body pad">
          <div className="acct-list" role="radiogroup" aria-label="시연 계정">
            {Object.values(ROLES).map((r) => (
              <button type="button" role="radio" aria-checked={pick === r.id} key={r.id} className={`acct ${pick === r.id ? 'on' : ''}`} onClick={() => choose(r)}>
                <span className="acct-name">{r.name}<span className="muted"> · {r.title}</span></span>
                <span className="acct-desc muted small">{r.desc}</span>
                <span className="acct-id mono">{r.loginId}</span>
              </button>
            ))}
          </div>
          <FormGroup label="아이디" labelFor="login-id">
            <InputGroup id="login-id" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" />
          </FormGroup>
          <FormGroup label="비밀번호" labelFor="login-pw" helperText="시연 계정 비밀번호는 모두 1234입니다. 실제 인증이 아닙니다.">
            <InputGroup id="login-pw" type="password" inputRef={pwEl} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </FormGroup>
          {err && <Callout intent="danger" icon="error" compact className="login-err">{err}</Callout>}
          <Button type="submit" intent="primary" fill size="large" text="로그인" endIcon="arrow-right" />
        </div>
      </form>
    </div>
  )
}
