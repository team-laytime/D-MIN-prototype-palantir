import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { browser } from './browser.mjs'
import { contrastExpression } from './contrast.mjs'

const label = process.argv[2] || 'candidate'
const out = resolve('docs/design-harness/evidence', label)
const base = process.env.DESIGN_QA_URL || 'http://127.0.0.1:5175/'
const url = new URL(base); url.searchParams.set('view', 'admin')
const b = await browser(), checks = []
const check = async (name, fn) => { await fn(); checks.push({ name, result: 'pass' }); console.log('PASS', name) }
const key = async (name, code = name, number = name === 'Tab' ? 9 : name === 'Escape' ? 27 : name === ' ' ? 32 : 13, modifiers = 0) => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: number, modifiers, ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) })
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: number, modifiers })
}
const modalScope = 'document.querySelector(".dmin-admin-dialog:not(.am-inspector-dialog)")'
const state = () => b.evaluate(`JSON.parse(localStorage.getItem('dmin.admin.accounts.v1'))`)
async function submit(label) { await b.click(label, modalScope); await b.waitFor('!document.querySelector(".dmin-admin-dialog:not(.am-inspector-dialog)")') }
try {
  await mkdir(out, { recursive: true }); await b.viewport(1440,900); await b.navigate(url.href); await b.waitFor('!!document.querySelector(".dmin-admin")')
  const receivedBefore = await b.evaluate('document.querySelector(".am-workload").textContent')
  await check('초기 검토 미완료 상태에서 승인 차단', async () => { assert.equal(await b.evaluate('document.querySelector(".am-primary").disabled'),true); assert.match(await b.evaluate('document.querySelector(".am-prerequisite").textContent'),/필수 확인/) })
  await check('키보드 Tab으로 목록 행 이동', async () => {
    await b.evaluate(`document.querySelector('.am-row-select').focus()`); await key('Tab')
    assert.equal(await b.evaluate(`document.activeElement.classList.contains('am-row-select')`), true)
    assert.match(await b.evaluate('document.activeElement.textContent'), /박서연/)
  })
  await check('키보드 Space로 검토 확인, 승인 모달 Escape와 초점 복귀', async () => {
    await b.evaluate(`document.querySelector('.am-check input').focus()`); await key(' ', 'Space')
    assert.equal(await b.evaluate(`document.querySelector('.am-check input').checked`), true)
    await b.evaluate(`document.querySelector('.am-primary').focus()`); await key('Enter')
    await b.waitFor('!!document.querySelector(".dmin-admin-dialog")')
    await key('Escape'); await b.waitFor('!document.querySelector(".dmin-admin-dialog")')
    assert.match(await b.evaluate('document.activeElement.textContent'), /승인하기/)
  })
  await check('승인 처리와 새로고침 후 보존', async () => {
    await b.click('승인하기'); await submit('승인하기')
    assert.equal((await state()).accounts.find(a => a.id === 'SK10248').status, 'active');assert.equal((await state()).history[0].detail,'');assert.equal(await b.evaluate('document.querySelector(".am-workload").textContent.split("·")[0]'),receivedBefore.split('·')[0])
    await b.reload(); await b.waitFor('!!document.querySelector(".dmin-admin")')
    assert.equal((await state()).accounts.find(a => a.id === 'SK10248').status, 'active')
  })
  await check('검색·역할·부두 필터와 빈 결과', async () => {
    await b.input('.am-search input', '없는사용자'); assert.match(await b.evaluate(`document.querySelector('tbody').textContent`), /검색 조건에 맞는/)
    await b.input('.am-search input', ''); await b.input('select[aria-label="담당 부두 · 팀 필터"]', 'SK 5부두 하역 1팀')
    assert.equal(await b.evaluate(`document.querySelectorAll('.am-row-select').length`), 1)
    await b.input('select[aria-label="담당 부두 · 팀 필터"]', ''); await b.input('select[aria-label="역할 필터"]', 'scheduler')
    assert.match(await b.evaluate(`document.querySelector('tbody').textContent`), /박서연/)
  })
  await check('실제 입력으로 반려 사유 저장', async () => {
    await b.click('반려하기'); await b.input('textarea', '팀장 승인 확인 후 다시 신청해 주세요.'); await submit('반려하기')
    assert.equal((await state()).accounts.find(a => a.id === 'SK10315').status, 'rejected')
  })
  await b.click('전체 계정')
  await check('권한 변경의 팀장 승인 요구', async () => {
    await b.click('변경'); await b.input('.am-form-label select', 'scheduler')
    assert.equal(await b.evaluate(`document.querySelector('.am-dialog-actions button:last-child').disabled`), true)
    await b.evaluate(`document.querySelector('.am-notify input').focus()`); await key(' ', 'Space'); await submit('변경하기')
    assert.equal((await state()).accounts.find(a => a.id === 'SK10248').role, 'scheduler')
  })
  await check('활성 상태 변경과 감사 이력', async () => {
    await b.click('계정 비활성화'); await submit('비활성화')
    assert.equal((await state()).accounts.find(a => a.id === 'SK10248').status, 'inactive')
    await b.click('계정 활성화'); await submit('활성화')
    assert.equal((await state()).history.length, 5);assert.equal((await state()).history[0].detail,'');assert.equal((await state()).history[0].notifyRequested,false)
  })
  await check('좁은 화면의 메뉴 이름·아이콘과 검토 모달 왕복', async () => {
    await b.viewport(390,844); await b.waitFor('!!document.querySelector(".am-mobile-row")')
    assert.equal(await b.evaluate(`(()=>{const n=document.querySelector('.am-sidebar nav button');return n.getAttribute('aria-label')==='가입 신청'&&getComputedStyle(n.querySelector('.bp6-icon')).display!=='none'})()`), true)
    await b.evaluate(`document.querySelector('.am-mobile-row').focus()`); await key('Enter'); await b.waitFor('!!document.querySelector(".am-inspector-dialog")')
    await b.click('변경'); await b.waitFor('!!document.querySelector(".dmin-admin-dialog:not(.am-inspector-dialog)")')
    await b.waitFor(`!!document.activeElement.closest('.dmin-admin-dialog:not(.am-inspector-dialog)')`); await key('Tab'); await b.waitFor(`!!document.activeElement.closest('.dmin-admin-dialog:not(.am-inspector-dialog)')`)
    await key('Tab', 'Tab', 9, 8); await b.waitFor(`!!document.activeElement.closest('.dmin-admin-dialog:not(.am-inspector-dialog)')`)
    await key('Escape'); await b.waitFor('!document.querySelector(".dmin-admin-dialog:not(.am-inspector-dialog)")')
    assert.equal(await b.evaluate(`!!document.querySelector('.am-inspector-dialog')`), true)
    await b.waitFor(`!!document.activeElement.closest('.am-inspector-dialog')`); await key('Escape'); await b.waitFor('!document.querySelector(".am-inspector-dialog")')
    assert.equal(await b.evaluate(`document.activeElement.classList.contains('am-mobile-row')`), true)
    await b.screenshot(join(out, 'keyboard-return-390.png'))
  })
  await check('모바일 빈 결과와 조건 초기화', async () => { await b.input('.am-search input','없는사용자');assert.match(await b.evaluate('document.querySelector(".am-empty").textContent'),/검색 조건/);await b.click('초기화');assert.ok(await b.evaluate('document.querySelectorAll(".am-mobile-row").length>0')) })
  await check('지원 뷰포트 가로 넘침 없음', async () => {
    for (const [width,height] of [[1920,1080],[1440,900],[1280,800],[768,1024],[390,844]]) {
      await b.viewport(width,height)
      if(width<=1100)await b.waitFor('!!document.querySelector(".am-mobile-row")')
      if(width<=1100)assert.equal(await b.evaluate('(()=>{const p=document.querySelector(".am-mobile-row p"),r=p.getBoundingClientRect(),row=p.parentElement.getBoundingClientRect();const account=JSON.parse(localStorage.getItem("dmin.admin.accounts.v1")).accounts.find(a=>a.id===p.parentElement.querySelector("small").textContent);return p.querySelector("span").textContent===account.team&&p.textContent.includes(({user:"일정 이용자",scheduler:"선박 스케줄러"})[account.role])&&r.top>=row.top&&r.bottom<=row.bottom})()'),true)
      assert.equal(await b.evaluate('document.body.scrollWidth<=innerWidth'), true, `overflow ${width}`)
    }
  })
  await b.viewport(1440,900);await b.navigate(url.href);await b.waitFor('!!document.querySelector(".dmin-admin")');await b.click('전체 계정')
  await check('감사 기록 없음과 실제 이벤트 구분',async()=>{await b.input('.am-search input','SK10104');assert.match(await b.evaluate('document.querySelector(".am-audit").textContent'),/변경 이력이 없습니다/);assert.equal(await b.evaluate('!!document.querySelector(".am-audit time")'),false);await b.click('초기화')})
  await check('승인 완료 집계에 비활성 계정 포함',async()=>{await b.click('가입 신청');await b.click('승인 완료');assert.equal(await b.evaluate('document.querySelectorAll(".am-row-select").length'),7);assert.match(await b.evaluate('document.querySelector("tbody").textContent'),/윤지현/)})
  await check('저장 실패 시 입력과 선택 유지 후 재시도',async()=>{
    await b.click('승인 대기');await b.click('반려하기');await b.input('textarea','확인할 소속 정보를 입력했습니다.');await b.evaluate('window.__qaSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("QA quota","QuotaExceededError")}');await b.click('반려하기',modalScope);assert.match(await b.evaluate('document.querySelector(".dmin-admin-dialog .am-error").textContent'),/저장 공간/);assert.equal(await b.evaluate('document.querySelector("textarea").value'),'확인할 소속 정보를 입력했습니다.');await b.evaluate('Storage.prototype.setItem=window.__qaSetItem');await submit('반려하기')
  })
  await check('손상 데이터 원본 보존과 재확인 복구',async()=>{
    await b.evaluate('window.__qaRaw=localStorage.getItem("dmin.admin.accounts.v1");localStorage.setItem("dmin.admin.accounts.v1","{invalid");window.dispatchEvent(new StorageEvent("storage",{key:"dmin.admin.accounts.v1"}))');assert.match(await b.evaluate('document.querySelector(".am-storage-error").textContent'),/원본은 보존/);assert.equal(await b.evaluate('localStorage.getItem("dmin.admin.accounts.v1")'),'{invalid');assert.match(await b.evaluate('document.querySelector(".am-heading-count").textContent'),/—/);await b.evaluate('localStorage.setItem("dmin.admin.accounts.v1",window.__qaRaw)');await b.click('다시 확인');assert.equal(await b.evaluate('!!document.querySelector(".am-storage-error")'),false)
  })
  const contrast=[]
  await b.click('전체 계정');await b.input('.am-search input','SK10104');contrast.push(await b.evaluate(contrastExpression));await b.click('변경');contrast.push(await b.evaluate(contrastExpression));await b.click('취소',modalScope)
  await check('실제 렌더링 텍스트 대비와 최소 글자 크기',async()=>{for(const result of contrast){assert.deepEqual(result.failures,[]);assert.deepEqual(result.smallText,[])}})
  await writeFile(join(out,'contrast.json'),JSON.stringify(contrast,null,2))
  await check('기존 로그인과 두 역할의 메뉴 보존',async()=>{
    for(const id of ['scheduler','user']){await b.navigate(base);await b.waitFor('!!document.querySelector(".login-page")');await b.input('#login-id',id);await b.input('#login-pw','1234');await b.click('로그인');await b.waitFor('!!document.querySelector(".rail")');const text=await b.evaluate('document.querySelector(".rail").textContent');assert.match(text,id==='scheduler'?/후보 비교/:/확정 접안 일정/)}
  })
  const productErrors = b.errors.filter(e => typeof e === 'string' || !e.url?.endsWith('/favicon.ico'))
  assert.deepEqual(productErrors, [])
  checks.push({name:'신규 런타임·리소스 오류 없음 (기존 favicon404 별도 기록)',result:'pass'})
  await writeFile(join(out, 'verification.json'), JSON.stringify({ checks, errors: b.errors, verified: ['keyboard Tab/Shift+Tab/Space/Enter/Escape', 'focus return', 'account actions', 'responsive layout'], notVerified: ['server authentication', 'real email delivery', 'screen reader speech', 'real customer acceptance'] }, null, 2))
} catch (error) {
  await writeFile(join(out, 'verification.json'), JSON.stringify({checks,error:String(error),activeElement:await b.evaluate('document.activeElement.outerHTML'),errors:b.errors},null,2)); throw error
} finally { await b.close() }
