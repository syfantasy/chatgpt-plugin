import crypto from 'crypto'
import { GoogleGeminiClient } from './GoogleGeminiClient.js'
import { newFetch } from '../utils/proxy.js'
import _ from 'lodash'

const BASEURL = 'https://generativelanguage.googleapis.com'

export const HarmCategory = {
  HARM_CATEGORY_UNSPECIFIED: 'HARM_CATEGORY_UNSPECIFIED',
  HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
  HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
  HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  HARM_CATEGORY_CIVIC_INTEGRITY: 'HARM_CATEGORY_CIVIC_INTEGRITY'
}

export const HarmBlockThreshold = {
  HARM_BLOCK_THRESHOLD_UNSPECIFIED: 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
  BLOCK_LOW_AND_ABOVE: 'BLOCK_LOW_AND_ABOVE',
  BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
  BLOCK_ONLY_HIGH: 'BLOCK_ONLY_HIGH',
  BLOCK_NONE: 'BLOCK_NONE',
  OFF: 'OFF'
}

/**
 * @typedef {{
 *   role: string,
 *   parts: Array<{
 *     text?: string,
 *     functionCall?: FunctionCall,
 *     functionResponse?: FunctionResponse,
 *     executableCode?: {
 *       language: string,
 *       code: string
 *     },
 *     codeExecutionResult?: {
 *       outcome: string,
 *       output: string
 *     }
 *   }>
 * }} Content
 *
 * Gemini消息的基本格式
 */

/**
 * @typedef {{
 *   searchEntryPoint: {
 *     renderedContent: string,
 *   },
 *   groundingChunks: Array<{
 *     web: {
 *       uri: string,
 *       title: string
 *     }
 *   }>,
 *   webSearchQueries: Array<string>
 * }} GroundingMetadata
 * 搜索结果的元数据
 */

/**
 * @typedef {{
 *    name: string,
 *    args: {}
 * }} FunctionCall
 *
 * Gemini的FunctionCall
 */

/**
 * @typedef {{
 *   name: string,
 *   response: {
 *     name: string,
 *     content: {}
 *   }
 * }} FunctionResponse
 *
 * Gemini的Function执行结果包裹
 * 其中response可以为任意，本项目根据官方示例封装为name和content两个字段
 */

export class CustomGoogleGeminiClient extends GoogleGeminiClient {
  constructor (props) {
    super(props)
    this.model = props.model
    this.baseUrl = props.baseUrl || BASEURL
    this.supportFunction = true
    this.debug = props.debug
  }

  /**
   *
   * @param text
   * @param {{
   *     conversationId: string?,
   *     parentMessageId: string?,
   *     stream: boolean?,
   *     onProgress: function?,
   *     functionResponse: FunctionResponse?,
   *     system: string?,
   *     image: string?,
   *     maxOutputTokens: number?,
   *     temperature: number?,
   *     topP: number?,
   *     tokK: number?,
   *     replyPureTextCallback: Function,
   *     toolMode: 'AUTO' | 'ANY' | 'NONE'
   *     search: boolean,
   *     codeExecution: boolean
   * }} opt
   * @returns {Promise<{conversationId: string?, parentMessageId: string, text: string, id: string}>}
   */
  async sendMessage (text, opt = {}) {
    let history = await this.getHistory(opt.parentMessageId)
    let systemMessage = opt.system
    if (systemMessage) {
      history = history.reverse()
      history.push({
        role: 'model',
        parts: [
          {
            text: 'ok'
          }
        ]
      })
      history.push({
        role: 'user',
        parts: [
          {
            text: systemMessage
          }
        ]
      })
      history = history.reverse()
    }
    const idThis = crypto.randomUUID()
    const idModel = crypto.randomUUID()
    const thisMessage = opt.functionResponse
      ? {
          role: 'user',
          parts: [{
            functionResponse: opt.functionResponse
          }],
          id: idThis,
          parentMessageId: opt.parentMessageId || undefined
        }
      : {
          role: 'user',
          parts: [{ text }],
          id: idThis,
          parentMessageId: opt.parentMessageId || undefined
        }
    if (opt.image) {
      thisMessage.parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: opt.image
        }
      })
    }
    history.push(_.cloneDeep(thisMessage))
    let url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent`
    let body = {
      // 不去兼容官方的简单格式了，直接用，免得function还要转换
      /**
       * @type Array<Content>
       */
      contents: history,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.OFF
        },
        {
          category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
          threshold: HarmBlockThreshold.BLOCK_NONE
        }
      ],
      generationConfig: {
        maxOutputTokens: opt.maxOutputTokens || 1000,
        temperature: opt.temperature || 0.9,
        topP: opt.topP || 0.95,
        topK: opt.tokK || 16
      },
      tools: []
    }
    if (this.tools?.length > 0) {
      body.tools.push({
        function_declarations: this.tools.map(tool => tool.function())
        // codeExecution: {}
      })

      // ANY要笑死人的效果
      let mode = opt.toolMode || 'AUTO'
      let lastFuncName = opt.functionResponse?.name
      const mustSendNextTurn = [
        'searchImage', 'searchMusic', 'searchVideo'
      ]
      if (lastFuncName && mustSendNextTurn.includes(lastFuncName)) {
        mode = 'ANY'
      }
      body.tool_config = {
        function_calling_config: {
          mode
        }
      }
    }
    if (opt.search) {
      body.tools.push({ google_search: {} })
    }
    if (opt.codeExecution) {
      body.tools.push({ code_execution: {} })
    }
    if (opt.image) {
      delete body.tools
    }
    body.contents.forEach(content => {
      delete content.id
      delete content.parentMessageId
      delete content.conversationId
    })
    // logger.info(JSON.stringify(body))
    let result = await newFetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'x-goog-api-key': this._key
      }
    })
    if (result.status !== 200) {
      throw new Error(await result.text())
    }
    /**
     * @type {Content | undefined}
     */
    let responseContent
    /**
     * @type {{candidates: Array<{content: Content, groundingMetadata: GroundingMetadata}>}}
     */
    let response = await result.json()
    if (this.debug) {
      console.log(JSON.stringify(response))
    }
    responseContent = response.candidates[0].content
    let groundingMetadata = response.candidates[0].groundingMetadata
    if (responseContent.parts.find(i => i.functionCall)) {
      // functionCall
      const functionCall = responseContent.parts.find(i => i.functionCall).functionCall
      const text = responseContent.parts.find(i => i.text)?.text
      if (text) {
        // send reply first
        logger.info('send message: ' + text)
        opt.replyPureTextCallback && await opt.replyPureTextCallback(text)
      }
      // Gemini有时候只回复一个空的functionCall,无语死了
      if (functionCall.name) {
        logger.info(JSON.stringify(functionCall))
        const funcName = functionCall.name
        let chosenTool = this.tools.find(t => t.name === funcName)
        /**
         * @type {FunctionResponse}
         */
        let functionResponse = {
          name: funcName,
          response: {
            name: funcName,
            content: null
          }
        }
        if (!chosenTool) {
          // 根本没有这个工具！
          functionResponse.response.content = {
            error: `Function ${funcName} doesn't exist`
          }
        } else {
          // execute function
          try {
            let isAdmin = ['admin', 'owner'].includes(this.e.sender.role) || (this.e.group?.is_admin && this.e.isMaster)
            let isOwner = ['owner'].includes(this.e.sender.role) || (this.e.group?.is_owner && this.e.isMaster)
            let args = Object.assign(functionCall.args, {
              isAdmin,
              isOwner,
              sender: this.e.sender,
              mode: 'gemini'
            })
            functionResponse.response.content = await chosenTool.func(args, this.e)
            if (this.debug) {
              logger.info(JSON.stringify(functionResponse.response.content))
            }
          } catch (err) {
            logger.error(err)
            functionResponse.response.content = {
              error: `Function execute error: ${err.message}`
            }
          }
        }
        let responseOpt = _.cloneDeep(opt)
        responseOpt.parentMessageId = idModel
        responseOpt.functionResponse = functionResponse
        // 递归直到返回text
        // 先把这轮的消息存下来
        await this.upsertMessage(thisMessage)
        responseContent = handleSearchResponse(responseContent).responseContent
        const respMessage = Object.assign(responseContent, {
          id: idModel,
          parentMessageId: idThis
        })
        await this.upsertMessage(respMessage)
        return await this.sendMessage('', responseOpt)
      } else {
        // 谷歌抽风了，瞎调函数，不保存这轮，直接返回
        return {
          text: '',
          conversationId: '',
          parentMessageId: opt.parentMessageId,
          id: '',
          error: true
        }
      }
    }
    if (responseContent) {
      await this.upsertMessage(thisMessage)
      const respMessage = Object.assign(responseContent, {
        id: idModel,
        parentMessageId: idThis
      })
      await this.upsertMessage(respMessage)
    }
    let { final } = handleSearchResponse(responseContent)
    try {
      if (groundingMetadata?.groundingChunks) {
        final += '\n参考资料\n'
        groundingMetadata.groundingChunks.forEach(chunk => {
          // final += `[${chunk.web.title}](${chunk.web.uri})\n`
          final += `[${chunk.web.title}]\n`
        })
        groundingMetadata.webSearchQueries.forEach(q => {
          logger.info('search query: ' + q)
        })
      }
    } catch (err) {
      logger.warn(err)
    }

    return {
      text: final,
      conversationId: '',
      parentMessageId: idThis,
      id: idModel
    }
  }
}

/**
 * 处理成单独的text
 * @param {Content} responseContent
 * @returns {{final: string, responseContent}}
 */
function handleSearchResponse (responseContent) {
  let final = ''

  // 遍历每个 part 并处理
  responseContent.parts = responseContent.parts.map((part) => {
    let newText = ''

    if (part.text) {
      newText += part.text
      final += part.text // 累积到 final
    }
    if (part.executableCode) {
      const codeBlock = '\n执行代码：\n' + '```' + part.executableCode.language + '\n' + part.executableCode.code.trim() + '\n```\n\n'
      newText += codeBlock
      final += codeBlock // 累积到 final
    }
    if (part.codeExecutionResult) {
      const resultBlock = `\n执行结果(${part.codeExecutionResult.outcome})：\n` + '```\n' + part.codeExecutionResult.output + '\n```\n\n'
      newText += resultBlock
      final += resultBlock // 累积到 final
    }

    // 返回更新后的 part，但不设置空的 text
    const updatedPart = { ...part }
    if (newText) {
      updatedPart.text = newText // 仅在 newText 非空时设置 text
    } else {
      delete updatedPart.text // 如果 newText 是空的，则删除 text 字段
    }

    return updatedPart
  })

  return {
    final,
    responseContent
  }
}
