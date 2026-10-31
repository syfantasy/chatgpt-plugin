import plugin from '../../../lib/plugins/plugin.js'
import ChatGPTConfig from '../config/config.js'
import { chaiteClient } from '../utils/client.js'

export class ChatGPTChat extends plugin {
  constructor() {
    super({
      name: 'ChatGPT-对话',
      dsc: 'Chaite 2.0 智能对话与群聊上下文记录',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: '.*',
          fnc: 'recordFlow',
          log: false,
        },
        {
          reg: '.*',
          fnc: 'handleChat',
        },
      ],
    })
  }

  /**
   * 旁路记录群聊流水进 Chaite 双水位线上下文池（绝不拦截其他插件）
   */
  async recordFlow() {
    if (this.e.isGroup) {
      chaiteClient.recordMessage(this.e).catch(() => {})
    }
    return false
  }

  /**
   * 对话调度核心
   */
  async handleChat() {
    const e = this.e
    const cfg = ChatGPTConfig

    // 1. 判断是否命中对话触发条件
    const trigger = this.checkTrigger(e, cfg)
    if (!trigger.matched) {
      // 1.1 预设触发词：命中 Chaite 面板中配置的预设前缀（如 xsy）直接唤醒
      //     （prompt 传原始消息，由 Chaite 内部完成前缀剥离与预设选择）
      if (e.msg && e.msg.trim()) {
        const presetHit = await chaiteClient.matchPresetTrigger(e.msg).catch(() => null)
        if (presetHit) {
          return this.doChat(e, e.msg.trim(), { presetId: presetHit.presetId })
        }
      }
      // 检查是否命中伪人模式 (bym)
      if (this.checkBymTrigger(e, cfg)) {
        return this.doChat(e, e.msg || '', { isBym: true, presetId: cfg.bym.preset })
      }
      return false
    }

    const prompt = trigger.prompt.trim()
    if (!prompt && (!e.img || e.img.length === 0)) {
      return false
    }

    return this.doChat(e, prompt, {})
  }

  /**
   * 执行对话请求并响应
   */
  async doChat(e, prompt, options = {}) {
    try {
      const response = await chaiteClient.chat(e, prompt, options)
      if (!response || (!response.text && (!response.images || response.images.length === 0))) {
        return true
      }

      const replyItems = []

      // 文本回复
      if (response.text) {
        replyItems.push(response.text)
      }

      // 附加图片回复
      if (Array.isArray(response.images)) {
        for (const img of response.images) {
          if (typeof img === 'string') {
            if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('base64://')) {
              replyItems.push(segment.image(img))
            } else if (img.startsWith('data:image/')) {
              replyItems.push(segment.image(img))
            }
          }
        }
      }

      // 发送回复（是否引用由 chaite 预设的 quoteReply 决定，不再硬编码引用）
      const quote = !!response.quote
      if (replyItems.length === 1 && typeof replyItems[0] === 'string') {
        await e.reply(replyItems[0], quote)
      } else if (replyItems.length > 0) {
        await e.reply(replyItems, quote)
      }

      return true
    } catch (err) {
      logger.error('[ChatGPT-Plugin] 对话异常:', err?.message || err)
      if (ChatGPTConfig.basic.debug) {
        await e.reply(`[Chaite 响应错误] ${err?.message || '未知错误'}`)
      }
      return true
    }
  }

  /**
   * 触发检测逻辑
   */
  checkTrigger(e, cfg) {
    let msg = (e.msg || '').trim()

    // 私聊直接触发
    if (e.isPrivate) {
      return { matched: true, prompt: msg }
    }

    const mode = cfg.basic.toggleMode || 'at'
    const prefix = cfg.basic.togglePrefix || '#chat'

    // @Bot 模式
    if (mode === 'at' || mode === 'both') {
      if (e.atBot) {
        return { matched: true, prompt: msg }
      }
    }

    // 前缀模式
    if (mode === 'prefix' || mode === 'both') {
      if (msg.startsWith(prefix)) {
        const prompt = msg.slice(prefix.length).trim()
        return { matched: true, prompt }
      }
    }

    return { matched: false, prompt: '' }
  }

  /**
   * 伪人模式检测
   */
  checkBymTrigger(e, cfg) {
    if (!cfg.bym.enable || !e.isGroup) return false
    const msg = e.msg || ''

    // 必中词
    if (Array.isArray(cfg.bym.hit) && cfg.bym.hit.some((kw) => kw && msg.includes(kw))) {
      return true
    }

    // 概率触发
    if (cfg.bym.probability > 0 && Math.random() < cfg.bym.probability) {
      return true
    }

    return false
  }
}
