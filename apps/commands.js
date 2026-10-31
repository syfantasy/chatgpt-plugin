import plugin from '../../../lib/plugins/plugin.js'
import { chaiteClient } from '../utils/client.js'

/**
 * Chaite 指令分发（指令注册表单一来源在 Chaite，见 GET /api/bridge/commands）
 *
 * priority 1000：故意排在所有 Yunzai 原生插件之后——只有原生插件都没认领
 * 这条消息时，才由 Chaite 处理其注册表内的指令（#帮助/#状态 等），避免
 * 抢占宿主原生指令。想彻底让路时，在 Chaite 面板改 commandPrefix 即可。
 */
export class ChatGPTCommands extends plugin {
  constructor() {
    super({
      name: 'ChatGPT-Chaite指令',
      dsc: 'Chaite 注册表指令分发（低于 Yunzai 原生指令优先级）',
      event: 'message',
      priority: 1000,
      rule: [
        {
          reg: '.*',
          fnc: 'dispatch',
          log: false,
        },
      ],
    })
  }

  async dispatch() {
    const e = this.e
    if (!e.msg || !e.msg.trim()) return false

    const cmdHit = await chaiteClient.matchCommand(e.msg).catch(() => null)
    if (!cmdHit) return false

    // 命中 Chaite 注册表指令：原样转发，由 Chaite 的 handleMessage 执行并回复
    try {
      const response = await chaiteClient.chat(e, e.msg.trim())
      if (response && (response.text || (response.images && response.images.length > 0))) {
        const replyItems = []
        if (response.text) replyItems.push(response.text)
        for (const img of response.images || []) {
          if (typeof img === 'string' && (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('base64://') || img.startsWith('data:image/'))) {
            replyItems.push(segment.image(img))
          }
        }
        const quote = !!response.quote
        if (replyItems.length === 1 && typeof replyItems[0] === 'string') {
          await e.reply(replyItems[0], quote)
        } else if (replyItems.length > 0) {
          await e.reply(replyItems, quote)
        }
      }
      return true
    } catch (err) {
      logger.error('[ChatGPT-Chaite指令] 执行异常:', err?.message || err)
      return false
    }
  }
}
