import axios from 'axios'
import ChatGPTConfig from '../config/config.js'

export class ChaiteClient {
  static instance = null
  embeddedModule = null
  storageCtx = null
  embeddedChecked = false

  static getInstance() {
    if (!ChaiteClient.instance) {
      ChaiteClient.instance = new ChaiteClient()
    }
    return ChaiteClient.instance
  }

  async checkEmbedded() {
    if (this.embeddedChecked) return Boolean(this.embeddedModule)
    this.embeddedChecked = true

    if (ChatGPTConfig.chaite.mode === 'http') {
      return false
    }

    try {
      const mod = await import('chaite')
      if (mod && mod.handleMessage && mod.groupHistoryBuffer) {
        this.embeddedModule = mod
        if (mod.bootstrap) {
          // 内嵌模式下拉起整套 Chaite 运行时（包含 Web 管理控制台与数据库）
          mod.bootstrap().catch((err) => {
            console.error('[ChatGPT-Plugin] Chaite 内嵌服务启动异常:', err)
          })
        } else if (mod.initChaiteStorage) {
          this.storageCtx = await mod.initChaiteStorage()
        }
        return true
      }
    } catch {
      // 未安装本地依赖，回退至 HTTP 模式
    }
    return false
  }

  get http() {
    const baseURL = (ChatGPTConfig.chaite.url || 'http://127.0.0.1:48370').replace(/\/+$/, '')
    const token = ChatGPTConfig.chaite.token || ''
    return axios.create({
      baseURL,
      timeout: ChatGPTConfig.chaite.timeout || 120000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
    })
  }

  /**
   * 将 Yunzai/icqq 消息事件格式化为 Chaite 标准消息并推送到上下文缓冲池
   */
  async recordMessage(e) {
    if (!ChatGPTConfig.basic.enableGroupContext || !e.isGroup) return

    const payload = {
      message_type: 'group',
      sub_type: 'normal',
      group_id: e.group_id,
      user_id: e.user_id || e.sender?.user_id,
      message_id: e.message_id || Date.now(),
      time: e.time || Math.floor(Date.now() / 1000),
      raw_message: e.raw_message || e.msg || '',
      message: this.formatYunzaiMessageSegments(e),
      sender: {
        user_id: e.user_id || e.sender?.user_id,
        nickname: e.sender?.nickname || '',
        card: e.sender?.card || '',
        role: e.sender?.role || 'member',
        title: e.sender?.title || '',
        level: e.sender?.level || '',
      },
    }

    if (await this.checkEmbedded()) {
      try {
        await this.embeddedModule.groupHistoryBuffer.recordMessage(payload)
      } catch {}
      return
    }

    try {
      await this.http.post('/api/bridge/record', { event: payload }).catch(() => {})
    } catch {}
  }

  /**
   * 向 Chaite 发起对话请求 (自动适配本地依赖与远程 HTTP)
   */
  async chat(e, prompt, options = {}) {
    // 1. 本地依赖嵌入模式
    if (await this.checkEmbedded()) {
      const replies = []
      const virtualAdapter = {
        getSelfId: () => 0,
        sendGroupMsg: async (_gid, msg) => replies.push(msg),
        sendPrivateMsg: async (_uid, msg) => replies.push(msg),
      }

      const chaiteEvent = {
        type: e.isGroup ? 'group_message' : 'private_message',
        userId: String(e.user_id || e.sender?.user_id),
        groupId: e.isGroup ? String(e.group_id) : undefined,
        messageId: e.message_id,
        text: prompt,
        raw: {
          message_type: e.isGroup ? 'group' : 'private',
          group_id: e.isGroup ? e.group_id : undefined,
          user_id: e.user_id || e.sender?.user_id,
          message_id: e.message_id,
          raw_message: e.raw_message || prompt,
          message: this.formatYunzaiMessageSegments(e),
          sender: e.sender,
          _adapter: virtualAdapter,
        },
        client: virtualAdapter,
        sender: e.sender,
        presetId: options.presetId || ChatGPTConfig.chaite.defaultPreset || undefined,
      }

      const storageCtx = this.storageCtx || (await this.embeddedModule.initChaiteStorage?.())
      await this.embeddedModule.handleMessage(chaiteEvent, storageCtx)

      let replyText = ''
      const images = []
      for (const rep of replies) {
        if (typeof rep === 'string') {
          replyText += (replyText ? '\n' : '') + rep
        } else if (Array.isArray(rep)) {
          for (const seg of rep) {
            if (seg.type === 'text') replyText += seg.data?.text || ''
            if (seg.type === 'image' && seg.data?.file) images.push(seg.data.file)
          }
        }
      }

      return { text: replyText, images, replyMsgId: e.message_id }
    }

    // 2. HTTP 远程桥接模式
    const payload = {
      text: prompt,
      event: {
        message_type: e.isGroup ? 'group' : 'private',
        group_id: e.isGroup ? e.group_id : undefined,
        user_id: e.user_id || e.sender?.user_id,
        message_id: e.message_id,
        time: e.time || Math.floor(Date.now() / 1000),
        raw_message: e.raw_message || e.msg || prompt,
        message: this.formatYunzaiMessageSegments(e),
        sender: {
          user_id: e.user_id || e.sender?.user_id,
          nickname: e.sender?.nickname || '',
          card: e.sender?.card || '',
          role: e.sender?.role || 'member',
          title: e.sender?.title || '',
          level: e.sender?.level || '',
        },
      },
      presetId: options.presetId || ChatGPTConfig.chaite.defaultPreset || undefined,
      isBym: options.isBym || false,
    }

    const res = await this.http.post('/api/bridge/chat', payload)
    if (res.data?.code !== 0 && res.data?.status !== 'success' && !res.data?.data) {
      throw new Error(res.data?.msg || res.data?.message || 'Chaite 处理异常')
    }

    const result = res.data?.data || res.data
    return {
      text: result.text || result.content || '',
      images: result.images || [],
      replyMsgId: result.replyMsgId || e.message_id,
    }
  }

  /**
   * 重置当前用户或群的对话上下文
   */
  async reset(e, scope = 'group') {
    if (await this.checkEmbedded()) {
      if (e.isGroup && this.embeddedModule?.groupHistoryBuffer) {
        this.embeddedModule.groupHistoryBuffer.clear(e.group_id)
      }
      return '对话上下文已重置'
    }

    const payload = {
      scope,
      groupId: e.isGroup ? e.group_id : undefined,
      userId: e.user_id || e.sender?.user_id,
    }
    const res = await this.http.post('/api/bridge/reset', payload)
    return res.data?.msg || '对话上下文已重置'
  }

  /**
   * 获取管理面板免密登录链接
   */
  async getPanelUrl(hostOverride) {
    if (await this.checkEmbedded()) {
      const cfg = ChatGPTConfig.chaite
      const base = hostOverride || (cfg.url || 'http://127.0.0.1:48370').replace(/\/+$/, '')
      try {
        if (this.embeddedModule?.FrontEndAuthHandler && this.embeddedModule?.Chaite) {
          const authKey = this.embeddedModule.Chaite.getInstance?.().getGlobalConfig?.()?.getAuthKey?.() || 'chaite-key'
          const token = this.embeddedModule.FrontEndAuthHandler.generateJWT(authKey)
          return `${base}/#/?token=${encodeURIComponent(token)}`
        }
      } catch {}
      return `${base}/#/`
    }

    const res = await this.http.get('/api/bridge/panel-token')
    const token = res.data?.data?.token || res.data?.token
    const base = hostOverride || ChatGPTConfig.chaite.url.replace(/\/+$/, '')
    return `${base}/#/?token=${encodeURIComponent(token)}`
  }

  /**
   * 获取 Chaite 状态
   */
  async getStatus() {
    if (await this.checkEmbedded()) {
      return { status: 'online', mode: 'embedded', version: '2.0.0' }
    }
    const res = await this.http.get('/api/bridge/status')
    return res.data?.data || res.data
  }

  /**
   * 把 Yunzai 的 message 数组或原生片段转为 OneBot/CQ 规范格式
   */
  formatYunzaiMessageSegments(e) {
    const segments = []
    const raw = e.message || []

    if (Array.isArray(raw)) {
      for (const seg of raw) {
        if (seg.type === 'text') {
          segments.push({ type: 'text', data: { text: seg.text || '' } })
        } else if (seg.type === 'image') {
          segments.push({ type: 'image', data: { file: seg.url || seg.file || '' } })
        } else if (seg.type === 'at') {
          segments.push({ type: 'at', data: { qq: String(seg.qq || '') } })
        } else if (seg.type === 'reply') {
          segments.push({ type: 'reply', data: { id: seg.id } })
        } else {
          segments.push(seg)
        }
      }
    } else if (typeof e.msg === 'string') {
      segments.push({ type: 'text', data: { text: e.msg } })
    }

    return segments
  }
}

export const chaiteClient = ChaiteClient.getInstance()
