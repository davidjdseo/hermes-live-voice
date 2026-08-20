import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(new URL('..', import.meta.url).pathname)
const template = fs.readFileSync(path.join(root, 'src/plugin.template.js'), 'utf8')
const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8')
const adapter = fs.readFileSync(path.join(root, 'src/adapters/contract.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'src/adapters/hermes.js'), 'utf8').replace("import { assertAgentHarnessAdapter } from './contract.js'", '')
const bridge = fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8').replace(/^import .*$/gm, '')
const runtime = fs.readFileSync(path.join(root, 'src/runtime.js'), 'utf8')
const output = template.replace('/* CORE_START */\n/* CORE_END */', core).replace('/* ADAPTER_START */\n/* ADAPTER_END */', adapter).replace('/* BRIDGE_START */\n/* BRIDGE_END */', bridge).replace('/* RUNTIME_START */\n/* RUNTIME_END */', runtime)
fs.mkdirSync(path.join(root, 'desktop'), { recursive: true })
fs.writeFileSync(path.join(root, 'desktop/plugin.js'), output)
console.log('generated desktop/plugin.js')
