import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { browser } from './browser.mjs'

const label = process.argv[2] || 'candidate'
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple evidence label')
const out = resolve('docs/design-harness/evidence', label)
const base = process.env.DESIGN_QA_URL || 'http://127.0.0.1:5175/'
const url = new URL(base); url.searchParams.set('view', 'admin')
const b = await browser()
const measurements = []
try {
  await mkdir(out, { recursive: true })
  for (const [width, height] of [[1920,1080],[1440,900],[1280,800],[768,1024],[390,844]]) {
    await b.viewport(width, height); await b.navigate(url.href); await b.waitFor('!!document.querySelector(".dmin-admin")')
    await b.screenshot(join(out, `requests-${width}.png`))
    await b.click('전체 계정'); await b.screenshot(join(out, `accounts-${width}.png`))
    measurements.push(await b.evaluate(`({width:innerWidth,height:innerHeight,bodyOverflow:document.body.scrollWidth>innerWidth,font:getComputedStyle(document.querySelector('h1')).fontFamily,logo:[...document.images].map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0,w:i.width,h:i.height})),visibleText:[...document.querySelectorAll('.am-directory-detail dt,.am-directory-detail dd')].map(e=>({text:e.textContent,size:getComputedStyle(e).fontSize,color:getComputedStyle(e).color}))})`))
  }
  if (await b.evaluate('!!document.querySelector(".am-mobile-row")')) {
    await b.evaluate('document.querySelector(".am-mobile-row").click()'); await b.waitFor('!!document.querySelector(".am-inspector-dialog")'); await b.screenshot(join(out, 'account-inspector-390.png'))
    await b.click('변경'); await b.screenshot(join(out, 'role-inspector-390.png')); await b.click('취소', 'document.querySelector(".dmin-admin-dialog:not(.am-inspector-dialog)")'); await b.click('목록으로')
  }
  await b.viewport(1440,900); await b.navigate(url.href); await b.waitFor('!!document.querySelector(".am-detail")')
  if (await b.evaluate('document.querySelector(".am-primary").disabled')) {
    await b.screenshot(join(out, 'approval-blocked-1440.png')); await b.evaluate('document.querySelector(".am-check input").click()'); await b.click('승인하기'); await b.screenshot(join(out, 'approval-ready-1440.png')); await b.click('취소', 'document.querySelector(".dmin-admin-dialog")'); await b.evaluate('document.querySelector(".am-check input").click()')
  } else { await b.click('승인하기'); await b.screenshot(join(out, 'approval-blocked-1440.png')); await b.click('취소', 'document.querySelector(".dmin-admin-dialog")') }
  await b.click('반려하기'); await b.input('textarea', '담당 부두와 소속 정보를 확인한 뒤 다시 신청해 주세요.'); await b.screenshot(join(out, 'rejection-1440.png')); await b.click('취소', 'document.querySelector(".dmin-admin-dialog")')
  await b.click('전체 계정'); await b.click('변경'); await b.screenshot(join(out, 'role-1440.png')); await b.click('취소', 'document.querySelector(".dmin-admin-dialog")')
  await b.click('계정 비활성화'); await b.screenshot(join(out, 'deactivation-1440.png')); await b.click('취소', 'document.querySelector(".dmin-admin-dialog")')
  await b.input('.am-search input', '없는사용자'); await b.screenshot(join(out, 'empty-1440.png'))
  await b.click('처리 이력'); await b.screenshot(join(out, 'history-empty-1440.png'))
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
  if (await b.evaluate('!!document.querySelector(".am-data-origin")')) {
    await b.viewport(390,844); await b.click('전체 계정'); await b.input('.am-search input', '없는사용자'); await b.screenshot(join(out, 'empty-390.png')); await b.click('초기화')
    await b.viewport(1440,900); await b.click('가입 신청'); await b.click('반려하기'); await b.input('textarea','소속 확인 후 다시 신청해 주세요.'); await b.evaluate('window.__qaSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException("QA quota","QuotaExceededError")}'); await b.click('반려하기', 'document.querySelector(".dmin-admin-dialog")'); await b.screenshot(join(out,'save-error-1440.png')); await b.evaluate('Storage.prototype.setItem=window.__qaSetItem'); await b.click('취소','document.querySelector(".dmin-admin-dialog")')
    await b.evaluate('window.__qaRaw=localStorage.getItem("dmin.admin.accounts.v1");localStorage.setItem("dmin.admin.accounts.v1","{invalid");window.dispatchEvent(new StorageEvent("storage",{key:"dmin.admin.accounts.v1"}))'); await b.screenshot(join(out,'storage-corrupt-1440.png'))
  }
  const { getAccounts } = await import('../../src/lib/accounts.js')
  const initial = getAccounts()
  await writeFile(join(out, 'capture.json'), JSON.stringify({label,base,widths:measurements,time:'2026-11-25T01:00:00Z',fixtureHash:initial?createHash('sha256').update(JSON.stringify({accounts:initial.accounts,history:initial.history})).digest('hex'):null,errors:b.errors},null,2))
  console.log(JSON.stringify({label,screenshots:(await readdir(out)).filter(p=>p.endsWith('.png')).length,errors:b.errors,out}))
} finally { await b.close() }
