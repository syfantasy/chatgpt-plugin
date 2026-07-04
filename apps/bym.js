import ChatGPTConfig from '../config/config.js'
import { Chaite } from 'chaite'
import { intoUserMessage, toYunzai } from '../utils/message.js'
import common from '../../../lib/common/common.js'
import { getGroupContextPrompt, buildGroupContextMessages, getGroupHistory } from '../utils/group.js'
import { formatTimeToBeiJing } from '../utils/common.js'
import { extractTextFromUserMessage, processUserMemory } from '../models/memory/userMemoryManager.js'
import { buildMemoryPrompt } from '../models/memory/prompt.js'
import * as crypto from 'node:crypto'

export class bym extends plugin {
  constructor () {
    super({
      name: 'ChatGPT-Plugin伪人模式',
      dsc: 'ChatGPT-Plugin伪人模式',
      event: 'message',
      priority: 6000,
      rule: [
        {
          reg: '^[^#][sS]*',
          fnc: 'bym',
          log: false
        }
      ]
    })
  }

  async bym (e) {
    if (!Chaite.getInstance()) {
      return false
    }
    if (!ChatGPTConfig.bym.enable) {
      return false
    }
    let prob = ChatGPTConfig.bym.probability
    if (ChatGPTConfig.bym.hit.find(keyword => e.msg?.includes(keyword))) {
      prob = 1
    }
    if (Math.random() > prob) {
      return false
    }
    logger.info('伪人模式触发')
    let recall = false
    let presetId = ChatGPTConfig.bym.defaultPreset
    if (ChatGPTConfig.bym.presetMap && ChatGPTConfig.bym.presetMap.length > 0) {
      const option = ChatGPTConfig.bym.presetMap.sort((a, b) => b.priority - a.priority)
        .find(item => item.keywords.find(keyword => e.msg?.includes(keyword)))
      if (option) {
        presetId = option.presetId
        recall = !!option.recall
      }
    }

    const presetManager = Chaite.getInstance().getChatPresetManager()
    let preset = await presetManager.getInstance(presetId)
    if (!preset) {
      preset = await presetManager.getInstance(ChatGPTConfig.bym.defaultPreset)
    }
    if (!preset) {
      logger.debug('未找到预设，请检查配置文件')
      return false
    }
    /**
     * @type {import('chaite').SendMessageOption}
     */
    const sendMessageOption = JSON.parse(JSON.stringify(preset.sendMessageOption))
    if (ChatGPTConfig.bym.presetPrefix) {
      if (!sendMessageOption.systemOverride) {
        sendMessageOption.systemOverride = ''
      }
      sendMessageOption.systemOverride = ChatGPTConfig.bym.presetPrefix + sendMessageOption.systemOverride
    }
    // 思维模型开启思考转发时禁用 streaming
    // chaite 绑定的 OpenAI SDK 版本过旧，streaming 路径无法聚合 reasoning_content，
    // 导致思考内容丢失（只残留一两个 token）。改用 non-streaming 路径获取完整 reasoning。
    if (ChatGPTConfig.bym.sendReasoning && sendMessageOption.isThinkingModel) {
      sendMessageOption.stream = false
    }
    // 不再将时间戳写入 systemOverride，保持 system prompt 静态以利用 LLM prompt cache
    if (ChatGPTConfig.bym.temperature >= 0) {
      sendMessageOption.temperature = ChatGPTConfig.bym.temperature
    }
    if (ChatGPTConfig.bym.maxTokens > 0) {
      sendMessageOption.maxToken = ChatGPTConfig.bym.maxTokens
    }
    const userMessage = await intoUserMessage(e, {
      handleReplyText: true,
      handleReplyImage: true,
      useRawMessage: true,
      handleAtMsg: true,
      excludeAtBot: false,
      toggleMode: ChatGPTConfig.basic.toggleMode,
      togglePrefix: ChatGPTConfig.basic.togglePrefix
    })
    const userText = extractTextFromUserMessage(userMessage) || e.msg || ''
    // 伪人不记录历史
    // sendMessageOption.disableHistoryRead = true
    // sendMessageOption.disableHistorySave = true
    sendMessageOption.conversationId = 'bym' + e.user_id + Date.now()
    sendMessageOption.parentMessageId = undefined
    // 设置多轮调用回掉
    sendMessageOption.onMessageWithToolCall = async content => {
      const { msgs, forward } = await toYunzai(e, [content])
      if (msgs.length > 0) {
        await e.reply(msgs)
      }
      for (let forwardElement of forward) {
        this.reply(forwardElement)
      }
    }
    // 构建动态上下文，作为独立 user message 插入历史
    // 从 system prompt 中分离，保持 system prompt 静态以利用 LLM prefix cache
    const contextSegments = []
    contextSegments.push(`Current Time: ${formatTimeToBeiJing(new Date().getTime())}`)
    if (userText) {
      const memoryPrompt = await buildMemoryPrompt({
        userId: e.sender.user_id + '',
        groupId: e.isGroup ? e.group_id + '' : null,
        queryText: userText
      })
      if (memoryPrompt) {
        contextSegments.push(memoryPrompt)
        logger.debug(`[Memory] bym memory prompt: ${memoryPrompt}`)
      }
    }

    // 群聊上下文：拆成独立消息，利用快照实现滑动窗口下的 prefix cache 复用
    let groupContextMsgs = []
    if (ChatGPTConfig.llm.enableGroupContext && e.isGroup) {
      const groupContext = await buildGroupContextMessages(
        e,
        ChatGPTConfig.llm.groupContextLength,
        {
          groupContextTemplatePrefix: ChatGPTConfig.llm.groupContextTemplatePrefix,
          groupContextTemplateMessage: ChatGPTConfig.llm.groupContextTemplateMessage,
          groupContextTemplateSuffix: ChatGPTConfig.llm.groupContextTemplateSuffix
        },
        getGroupHistory
      )
      if (groupContext?.messages.length) {
        // header 并入时间戳/记忆所在的消息
        if (groupContext.header) {
          contextSegments.push(groupContext.header)
        }
        for (const m of groupContext.messages) {
          groupContextMsgs.push(m.text)
        }
      }
    }

    // 保存时间戳 + 记忆 + 群聊 header 为一条消息
    if (contextSegments.length > 0) {
      const contextText = contextSegments.join('\n\n')
      const contextMsg = {
        id: crypto.randomUUID(),
        parentId: sendMessageOption.parentMessageId,
        role: 'user',
        content: [{ type: 'text', text: contextText }]
      }
      await Chaite.getInstance().getHistoryManager().saveHistory(contextMsg, sendMessageOption.conversationId)
      sendMessageOption.parentMessageId = contextMsg.id
    }

    // 群聊消息逐条保存为独立 user message，prefix cache 才能按行对齐复用
    for (const text of groupContextMsgs) {
      const msg = {
        id: crypto.randomUUID(),
        parentId: sendMessageOption.parentMessageId,
        role: 'user',
        content: [{ type: 'text', text: text }]
      }
      await Chaite.getInstance().getHistoryManager().saveHistory(msg, sendMessageOption.conversationId)
      sendMessageOption.parentMessageId = msg.id
    }
    // 发送
    const response = await Chaite.getInstance().sendMessage(userMessage, e, {
      ...sendMessageOption,
      chatPreset: preset
    })
    const { msgs, forward } = await toYunzai(e, response.contents)
    if (msgs.length > 0) {
      // await e.reply(msgs, false, { recallMsg: recall })
      for (let msg of msgs) {
        await e.reply(msg, false, { recallMsg: recall ? 10 : 0 })
        await common.sleep(Math.floor(Math.random() * 2000) + 1000)
      }
    }
    if (ChatGPTConfig.bym.sendReasoning) {
      for (let forwardElement of forward) {
        await e.reply(forwardElement, false, { recallMsg: recall ? 10 : 0 })
      }
    }
    // 异步提取记忆，不阻塞消息回复
    processUserMemory({
      event: e,
      userMessage,
      userText,
      conversationId: sendMessageOption.conversationId,
      assistantContents: response.contents,
      assistantMessageId: response.id
    }).catch(err => logger.warn('[Memory] user memory extraction failed:', err.message))
  }
}
