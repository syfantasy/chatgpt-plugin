import plugin from '../../../lib/plugins/plugin.js'
import ChatGPTConfig from '../config/config.js'
import { chaiteClient } from '../utils/client.js'

export class ChatGPTManagement extends plugin {
  constructor() {
    const cmd = ChatGPTConfig.basic.commandPrefix || '#chatgpt'
    super({
      name: 'ChatGPT-管理',
      dsc: 'Chaite 2.0 管理与控制台指令',
      event: 'message',
      priority: 20,
      rule: [
        {
          reg: `^(${cmd}|#chaite)管理面板$`,
          fnc: 'openPanel',
          permission: 'master',
        },
        {
          reg: `^${cmd}切换模式\\s*(at|prefix|both)$`,
          fnc: 'switchMode',
          permission: 'master',
        },
      ],
    })
  }

  /**
   * 生成并下发管理面板登录链接
   */
  async openPanel() {
    try {
      const url = await chaiteClient.getPanelUrl()
      const tip = `[Chaite Web 控制台]\n链接: ${url}\n注意: 该链接包含登录身份，请勿泄露给他人。`
      if (this.e.isGroup) {
        await this.e.reply('已向主人私聊发送管理面板链接，请注意查收。')
        await (this.e.bot || Bot).pickUser(this.e.user_id).sendMsg(tip)
      } else {
        await this.e.reply(tip)
      }
    } catch (err) {
      await this.e.reply(`获取控制台链接失败: ${err?.message || err}`)
    }
  }

  /**
   * 快捷切换触发模式
   */
  async switchMode() {
    const mode = this.e.msg.replace(/.*切换模式\s*/, '').trim().toLowerCase()
    if (!['at', 'prefix', 'both'].includes(mode)) {
      return this.e.reply('模式参数错误，支持: at, prefix, both')
    }
    ChatGPTConfig.basic.toggleMode = mode
    ChatGPTConfig.saveToFile()
    await this.e.reply(`触发模式已切换为: ${mode}`)
  }
}
