import fs from 'node:fs'
import path from 'node:path'
import ChatGPTConfig from './config/config.js'
import { chaiteClient } from './utils/client.js'

logger.info('======================================')
logger.info(`[ChatGPT-Plugin] Chaite 2.0 适配器加载中... (v${ChatGPTConfig.version})`)

if (!global.segment) {
  try {
    global.segment = (await import('icqq')).segment
  } catch (err) {
    try {
      global.segment = (await import('oicq')).segment
    } catch {}
  }
}

const appsDir = './plugins/chatgpt-plugin/apps'
const files = fs.existsSync(appsDir)
  ? fs.readdirSync(appsDir).filter((file) => file.endsWith('.js'))
  : ['chat.js', 'management.js', 'update.js']

const ret = await Promise.allSettled(files.map((file) => import(`./apps/${file}`)))

const apps = {}
for (let i = 0; i < files.length; i++) {
  const name = files[i].replace('.js', '')
  if (ret[i].status !== 'fulfilled') {
    logger.error(`[ChatGPT-Plugin] 载入模块错误: ${name}`)
    logger.error(ret[i].reason)
    continue
  }
  apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
}

// 异步检测 Chaite 服务健康状态并打出提示
chaiteClient
  .getStatus()
  .then(() => {
    logger.info(`[ChatGPT-Plugin] Chaite 服务连接成功: ${ChatGPTConfig.chaite.url}`)
  })
  .catch(() => {
    logger.warn(`[ChatGPT-Plugin] 警告: 无法连接至 Chaite 服务 (${ChatGPTConfig.chaite.url})，请确认 Chaite 是否已启动。`)
  })

logger.info(`[ChatGPT-Plugin] 加载完毕 | 触发模式: ${ChatGPTConfig.basic.toggleMode} | 默认预设: ${ChatGPTConfig.chaite.defaultPreset || '默认'}`)
logger.info('======================================')

export { apps }
