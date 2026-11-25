import test from 'node:test'
import assert from 'node:assert/strict'
import { ACCOUNT_KEY, changeAccount, getAccounts, SCHEDULER_TEAM, TEAMS } from './accounts.js'

const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
const reset = () => values.delete(ACCOUNT_KEY)

test('검토와 팀장 승인 없이는 스케줄러 신청을 승인하지 않는다', () => {
  reset()
  assert.throws(() => changeAccount('SK10315', 'approve'), /확인/)
  changeAccount('SK10315', 'check', { identityChecked: true })
  assert.throws(() => changeAccount('SK10315', 'approve'), /팀장/)
  changeAccount('SK10315', 'check', { managerApproved: true })
  const account = changeAccount('SK10315', 'approve', { notify: true })
  assert.equal(account.status, 'active')
  assert.equal(getAccounts().history[0].notifyRequested, true)
  assert.throws(() => changeAccount('SK10315', 'approve'), /이미 처리/)
  assert.equal(getAccounts().history.length, 1)
})

test('이용자 승인, 비활성화, 재활성화를 저장하고 이력을 남긴다', () => {
  reset()
  changeAccount('SK10248', 'check', { identityChecked: true })
  changeAccount('SK10248', 'approve')
  assert.equal(changeAccount('SK10248', 'toggle').status, 'inactive')
  assert.equal(changeAccount('SK10248', 'toggle').status, 'active')
  assert.deepEqual(getAccounts().history.map(h => h.action), ['계정 활성화', '계정 비활성화', '계정 승인'])
  assert.equal(JSON.parse(values.get(ACCOUNT_KEY)).accounts.find(a => a.id === 'SK10248').status, 'active')
})

test('반려 사유를 검증하며 이미 처리된 신청은 다시 반려하지 않는다', () => {
  reset()
  assert.throws(() => changeAccount('SK10162', 'reject', { reason: ' ' }), /반려 사유/)
  assert.throws(() => changeAccount('SK10162', 'reject', { reason: '가'.repeat(301) }), /반려 사유/)
  const account = changeAccount('SK10162', 'reject', { reason: '사번 확인 불가' })
  assert.equal(account.reason, '사번 확인 불가')
  assert.equal(account.status, 'rejected')
  assert.throws(() => changeAccount('SK10162', 'approve'), /이미 처리/)
})

test('권한 변경은 승인된 계정에만 허용하고 소속과 팀장 승인을 검증한다', () => {
  reset()
  assert.throws(() => changeAccount('SK10248', 'role', { role: 'user', team: TEAMS[0] }), /승인된 계정/)
  assert.throws(() => changeAccount('user', 'role', { role: 'admin', team: TEAMS[0] }), /역할과 소속/)
  assert.throws(() => changeAccount('user', 'role', { role: 'scheduler', team: SCHEDULER_TEAM }), /팀장 승인/)
  const account = changeAccount('user', 'role', { role: 'scheduler', team: SCHEDULER_TEAM, managerApproved: true })
  assert.equal(account.role, 'scheduler')
  assert.equal(getAccounts().history[0].detail, `선박 스케줄러 · ${SCHEDULER_TEAM}`)
})

test('잘못된 저장 내용은 화면을 중단하지 않으며 저장 실패는 성공으로 처리하지 않는다', () => {
  values.set(ACCOUNT_KEY, '{invalid')
  assert.doesNotThrow(() => changeAccount('SK10248', 'check', { identityChecked: true }))
  const previous = getAccounts()
  const write = globalThis.localStorage.setItem
  globalThis.localStorage.setItem = () => { throw new Error('quota') }
  assert.throws(() => changeAccount('SK10248', 'approve'), /저장 공간/)
  globalThis.localStorage.setItem = write
  assert.equal(getAccounts().accounts.find(a => a.id === 'SK10248').status, 'pending')
  assert.deepEqual(getAccounts().history, previous.history)
})
