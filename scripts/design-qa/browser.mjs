// Dependency-free CDP harness. Uses an isolated, disposable Chrome profile.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function browser() {
  const profile = await mkdtemp(join(tmpdir(), 'dmin-design-qa-'))
  const executable = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome did not start within 15 seconds')), 15000)
    child.on('error', reject)
    child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
  }).catch(async error => { child.kill(); await rm(profile, { recursive: true, force: true }); throw error })
  const origin = endpoint.replace('ws:', 'http:').replace(/\/devtools\/browser\/.*/, '')
  const pages = await (await fetch(`${origin}/json`)).json()
  const socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map(), events = new Map(), errors = []
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (events.has(message.method)) { events.get(message.method)(message.params); events.delete(message.method) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push({text:message.params.entry.text,url:message.params.entry.url,source:message.params.entry.source})
    if (message.id) { const p = pending.get(message.id); if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(message.error) : p.resolve(message.result) } }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const loaded = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Page load timeout')), 15000)
    events.set('Page.loadEventFired', () => { clearTimeout(timer); resolve() })
  })
  const waitFor = async expression => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)) }
    throw new Error(`Condition failed: ${expression}`)
  }
  const navigate = async url => { const done = loaded(); await send('Page.navigate', { url }); await done; await waitFor('document.readyState === "complete"') }
  const reload = async () => { const done = loaded(); await send('Page.reload'); await done }
  const click = async (label, scope = 'document') => {
    await evaluate(`(()=>{const root=${scope};const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}||[...b.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('').trim()===${JSON.stringify(label)});if(!button)throw Error('Missing button: '+${JSON.stringify(label)});if(button.disabled)throw Error('Disabled button: '+${JSON.stringify(label)});button.click()})()`)
    await evaluate('Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))'); await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
  const input = async (selector, value) => {
    await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing input');const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
  const screenshot = async path => { await mkdir(join(path, '..'), { recursive: true }); await evaluate('document.fonts.ready'); await evaluate('Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))'); await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path, Buffer.from(result.data, 'base64')) }
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true }); await send('Page.bringToFront')
  // Freeze only QA time. Production application, account fixtures, and user profile are untouched.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-11-25T01:00:00Z']))}static now(){return OriginalDate.parse('2026-11-25T01:00:00Z')}};` })
  return { send, evaluate, waitFor, navigate, reload, click, input, screenshot, errors,
    viewport: (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }),
    close: async () => { socket.close(); child.kill(); await new Promise(resolve => child.once('exit', resolve)); await rm(profile, { recursive: true, force: true }) },
  }
}
