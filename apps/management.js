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
          reg: `^(${cmd}|#chaite)?#(结束|重置|清空)(全部)?(对话|上下文)$`,
          fnc: 'resetContext',
        },
        {
          reg: `^(${cmd}|#chaite)(状态|信息)$`,
          fnc: 'showStatus',
          permission: 'master',
        },
        {
          reg: `^${cmd}切换模式\\s*(at|prefix|both)$`,
          fnc: 'switchMode',
          permission: 'master',
        },
        {
          reg: `^(${cmd}|#chaite)(帮助|help)?$`,
          fnc: 'showHelp',
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
   * 重置当前会话上下文
   */
  async resetContext() {
    try {
      const scope = this.e.msg.includes('全部') ? 'group' : (this.e.isGroup ? 'group' : 'user')
      const msg = await chaiteClient.reset(this.e, scope)
      await this.e.reply(msg || '已重置当前对话上下文。', true)
    } catch (err) {
      await this.e.reply(`重置失败: ${err?.message || err}`, true)
    }
  }

  /**
   * 查看系统状态
   */
  async showStatus() {
    try {
      const st = await chaiteClient.getStatus()
      const msg = [
        '【Chaite 2.0 运行状态】',
        `连接地址: ${ChatGPTConfig.chaite.url}`,
        `触发模式: ${ChatGPTConfig.basic.toggleMode} (前缀: ${ChatGPTConfig.basic.togglePrefix})`,
        `群聊上下文缓冲: ${ChatGPTConfig.basic.enableGroupContext ? '已开启' : '关闭'}`,
        `伪人插话模式: ${ChatGPTConfig.bym.enable ? '已开启' : '关闭'}`,
        `核心状态: ${st?.version ? `v${st.version}` : '正常在线'}`,
      ].join('\n')
      await this.e.reply(msg)
    } catch (err) {
      await this.e.reply(`Chaite 连接异常: ${err?.message || '无法连接到核心服务'}`)
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

  /**
   * 帮助信息
   */
  async showHelp() {
    const cmd = ChatGPTConfig.basic.commandPrefix
    const help = [
      '【Chaite 2.0 智能体助手】',
      `• 对话触发: ${ChatGPTConfig.basic.toggleMode === 'at' ? '@机器人 提问' : `${ChatGPTConfig.basic.togglePrefix} 提问`}`,
      '• 重置上下文: #结束对话 / #清空上下文',
      `• 管理面板: ${cmd}管理面板 (管理员)`,
      `• 查看状态: ${cmd}状态 (管理员)`,
      `• 切换模式: ${cmd}切换模式 at/prefix/both (管理员)`,
    ].join('\n')
    await this.e.reply(help)
  }
}
