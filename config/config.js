import fs from 'node:fs'
import yaml from 'js-yaml'

class ChatGPTConfig {
  version = '4.0.0'

  basic = {
    toggleMode: 'at', // 'at' | 'prefix' | 'both'
    togglePrefix: '#chat',
    commandPrefix: '#chatgpt',
    enableGroupContext: true, // 开启后群消息自动喂入 Chaite 上下文缓冲池
    debug: false,
  }

  chaite = {
    mode: 'auto', // 'auto' (自动探测本地依赖与远程) | 'http' (纯远程桥接) | 'embedded' (强制内嵌)
    url: 'http://127.0.0.1:48370',
    token: '',
    defaultPreset: '',
    timeout: 120000,
  }

  bym = {
    enable: false,
    hit: ['bym'],
    probability: 0.02,
    preset: '',
  }

  configDir = './plugins/chatgpt-plugin/config'
  configPath = './plugins/chatgpt-plugin/config/config.yaml'
  legacyDataPath = './plugins/chatgpt-plugin/data/config.json'

  constructor() {
    this.init()
  }

  init() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true })
    }

    if (fs.existsSync(this.configPath)) {
      this.loadFromFile()
    } else if (fs.existsSync(this.legacyDataPath)) {
      this.migrateFromLegacy()
    } else {
      this.saveToFile()
    }
  }

  loadFromFile() {
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8')
      const doc = yaml.load(content) || {}
      if (doc.basic) Object.assign(this.basic, doc.basic)
      if (doc.chaite) Object.assign(this.chaite, doc.chaite)
      if (doc.bym) Object.assign(this.bym, doc.bym)
    } catch (err) {
      console.error('[ChatGPT-Plugin] 加载配置文件失败，将使用默认配置:', err)
    }
  }

  saveToFile() {
    try {
      const data = {
        version: this.version,
        basic: this.basic,
        chaite: this.chaite,
        bym: this.bym,
      }
      fs.writeFileSync(this.configPath, yaml.dump(data, { indent: 2 }), 'utf-8')
    } catch (err) {
      console.error('[ChatGPT-Plugin] 保存配置文件失败:', err)
    }
  }

  migrateFromLegacy() {
    try {
      const raw = fs.readFileSync(this.legacyDataPath, 'utf-8')
      const legacy = JSON.parse(raw)
      if (legacy.basic) Object.assign(this.basic, legacy.basic)
      if (legacy.chaite) {
        if (legacy.chaite.host && legacy.chaite.port) {
          const host = legacy.chaite.host === '0.0.0.0' ? '127.0.0.1' : legacy.chaite.host
          this.chaite.url = `http://${host}:${legacy.chaite.port}`
        }
        if (legacy.chaite.authKey) {
          this.chaite.token = legacy.chaite.authKey
        }
      }
      if (legacy.bym) Object.assign(this.bym, legacy.bym)
      this.saveToFile()
      console.log('[ChatGPT-Plugin] 已自动从旧版 config.json 迁移配置至 config.yaml')
    } catch (e) {
      this.saveToFile()
    }
  }
}

export default new ChatGPTConfig()
