import axios from 'axios'
import ChatGPTConfig from '../config/config.js'

export class ChaiteClient {
  static instance = null

  static getInstance() {
    if (!ChaiteClient.instance) {
      ChaiteClient.instance = new ChaiteClient()
    }
    return ChaiteClient.instance
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

    try {
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

      await this.http.post('/api/bridge/record', { event: payload }).catch(() => {})
    } catch {
      // 旁路记录绝不阻塞正常业务
    }
  }

  /**
   * 向 Chaite 发起对话请求
   */
  async chat(e, prompt, options = {}) {
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
    const res = await this.http.get('/api/bridge/panel-token')
    const token = res.data?.data?.token || res.data?.token
    const base = hostOverride || ChatGPTConfig.chaite.url.replace(/\/+$/, '')
    return `${base}/#/?token=${encodeURIComponent(token)}`
  }

  /**
   * 获取 Chaite 状态
   */
  async getStatus() {
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
