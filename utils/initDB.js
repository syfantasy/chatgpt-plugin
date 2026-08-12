// initDB.js
// 插件初始化的基本数据库内容

import { BaseClientOptions, Chaite, Channel, ProcessorDTO, SendMessageOption, ToolDTO } from 'chaite'
import fs from 'fs'
import path from 'path'
import { md5 } from './common.js'

/**
 * 默认系统用户
 * @type {import('chaite').User}
 */
const systemUser = {
  username: 'system',
  user_id: '00000'
}

/**
 * Read bundled executable code from the tracked resources directory. Runtime
 * tool and processor directories are ignored because they contain user code.
 * @param {string} resourcesDir
 * @param {string} filename
 * @returns {string}
 */
function readEmbeddedCode (resourcesDir, filename) {
  const encoded = fs.readFileSync(path.resolve(resourcesDir, filename), 'utf-8')
  return Buffer.from(encoded.trim(), 'base64').toString('utf-8')
}

/**
 * 注入内置的处理器
 * @param {string} resourcesDir
 * @param {import('chaite').ProcessorsManager} processorsManager
 * @param {'pre' | 'post'} type
 * @param {string} name
 * @param {string} description
 * @returns {Promise<void>}
 */
async function addEmbeddedProcessor (resourcesDir, processorsManager, type, name, description) {
  const code = readEmbeddedCode(resourcesDir, name)
  await processorsManager.addInstance(new ProcessorDTO({
    id: md5(name),
    type,
    name,
    embedded: true,
    uploader: systemUser,
    description,
    code
  }))
}

const blackPreProcessorId = md5('BlackPreProcessor')
const blackPostProcessorId = md5('BlackPostProcessor')

/**
 * The original v3 bootstrap accidentally registered BlackPre/Post with
 * inverted DTO types. Keep this repair idempotent so existing installations
 * self-heal on upgrade without touching user-created processors.
 */
async function repairBlackProcessors (resourcesDir, processorsManager) {
  const definitions = [
    { id: blackPreProcessorId, name: 'BlackPreProcessor', type: 'pre', description: '内置用户消息屏蔽词前处理器' },
    { id: blackPostProcessorId, name: 'BlackPostProcessor', type: 'post', description: '内置机器人回复屏蔽词后处理器' }
  ]

  for (const definition of definitions) {
    const code = readEmbeddedCode(resourcesDir, definition.name)
    const existing = await processorsManager.getInstanceT(definition.id)
    if (!existing || existing.type !== definition.type || existing.code !== code || !existing.embedded) {
      await processorsManager.addInstance(new ProcessorDTO({
        ...existing,
        ...definition,
        code,
        embedded: true,
        uploader: existing?.uploader || systemUser
      }))
      logger.info(`修复内置处理器 ${definition.name} (${definition.type})`)
    }
  }
}

/** Move only the historical inverted Black IDs; never add filters to channels that never used them. */
async function repairBlackProcessorBindings (channelsManager) {
  const channels = await channelsManager.listInstances()
  let repaired = 0
  const unique = values => [...new Set(values)]

  for (const channel of channels) {
    const options = channel.options
    if (!options) continue
    const pre = [...(options.preProcessorIds || [])]
    const post = [...(options.postProcessorIds || [])]
    const hasInvertedPre = pre.includes(blackPostProcessorId)
    const hasInvertedPost = post.includes(blackPreProcessorId)
    if (!hasInvertedPre && !hasInvertedPost) continue

    options.preProcessorIds = unique([
      ...pre.filter(id => id !== blackPostProcessorId),
      ...(hasInvertedPost ? [blackPreProcessorId] : [])
    ])
    options.postProcessorIds = unique([
      ...post.filter(id => id !== blackPreProcessorId),
      ...(hasInvertedPre ? [blackPostProcessorId] : [])
    ])
    await channelsManager.upsertInstance(channel)
    repaired++
  }

  if (repaired) logger.info(`已修复 ${repaired} 个渠道的 Black 前后处理器挂载关系`)
}

export async function migrateDatabase () {
  logger.debug('检查数据库初始化...')
  const resourcesDir = path.resolve('./plugins/chatgpt-plugin', 'resources/embedded')
  // 1. 修复并设置内置处理器
  const processorsManager = Chaite.getInstance().getProcessorsManager()
  await repairBlackProcessors(resourcesDir, processorsManager)
  // 注册内置的图片引用预处理器
  const imageRefProcessorId = md5('ImageRefPreProcessor')
  const imageRefProcessorCode = readEmbeddedCode(resourcesDir, 'ImageRefPreProcessor')
  const storedImageRefProcessor = await processorsManager.getInstanceT(imageRefProcessorId)
  const loadedImageRefProcessor = await processorsManager.getInstance('ImageRefPreProcessor')
  if (!storedImageRefProcessor || storedImageRefProcessor.code !== imageRefProcessorCode || !loadedImageRefProcessor) {
    logger.info('初始化内置的图片引用预处理器')
    await processorsManager.addInstance(new ProcessorDTO({
      id: imageRefProcessorId,
      type: 'pre',
      name: 'ImageRefPreProcessor',
      embedded: true,
      uploader: systemUser,
      description: '自动处理图片：模型看得到的图片进入主干对话并隐藏 ref，看不到的图片（非视觉模型的全部图片、视觉模型的 GIF 等 forceImageRefMimes 格式）保留 ref 文本供识图工具查询',
      code: imageRefProcessorCode
    }))
  }
  // 2. 设置默认渠道
  const channelsManager = Chaite.getInstance().getChannelsManager()
  await repairBlackProcessorBindings(channelsManager)
  try {
    await channelsManager.getChannelByModel('Qwen/Qwen2.5-7B-Instruct')
  } catch (err) {
    if (err.message === 'No available channels') {
      await channelsManager.addInstance(new Channel({
        id: 'free',
        name: 'free',
        models: ['Qwen/Qwen2.5-7B-Instruct'],
        adapterType: 'openai',
        type: 'openai',
        weight: 1,
        priority: 0,
        status: 'enabled',
        options: new BaseClientOptions({
          features: ['tool', 'chat'],
          baseUrl: 'https://oneapi.ikechan8370.com/v1',
          apiKey: 'sk-uIzofH2TIMVu6giK56BeCeD5E98b42EbBe695597B5FeAc68',
          preProcessorIds: [imageRefProcessorId, blackPreProcessorId],
          postProcessorIds: [blackPostProcessorId]
        }),
        uploader: systemUser
      }))
      logger.info('初始化内置的免费渠道')
    }
  }
  // 3. 设置默认预设
  let chatPresetManager = Chaite.getInstance().getChatPresetManager()
  if (!await chatPresetManager.getInstance('default_local')) {
    await chatPresetManager.addInstance({
      id: 'default_local',
      local: true,
      name: '默认预设',
      prefix: 'chaite',
      sendMessageOption: new SendMessageOption({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        temperature: 0.8,
        maxToken: 4096,
        systemOverride: '你是Chaite，一个在QQ群聊中活跃的AI助手。你可以与群友进行聊天，提供帮助和解答问题。'
      }),
      uploader: systemUser
    })
    logger.info('初始化内置的默认预设')
  }

  // 4. 设置默认工具组
  let toolGroupsManager = Chaite.getInstance().getToolsGroupManager()
  if (!await toolGroupsManager.getInstance('default_local')) {
    await toolGroupsManager.addInstance({
      id: 'default_local',
      name: '默认工具组',
      description: '默认工具组仅用于占位，包括全部非禁用的工具',
      toolIds: [],
      status: 'enabled',
      isDefault: true,
      uploader: systemUser
    })
  }

  // 5. 扫描同步工具
  const toolManager = Chaite.getInstance().getToolsManager()

  // 注册内置的 ask_about_image 工具
  const askAboutImageToolId = md5('ask_about_image')
  const askAboutImageToolCode = readEmbeddedCode(resourcesDir, 'AskAboutImage')
  const storedAskAboutImageTool = await toolManager.getInstanceT(askAboutImageToolId)
  const loadedAskAboutImageTool = await toolManager.getInstance('ask_about_image')
  if (!storedAskAboutImageTool || storedAskAboutImageTool.code !== askAboutImageToolCode || !loadedAskAboutImageTool) {
    logger.info('初始化内置的 ask_about_image 工具')
    await toolManager.addInstance(new ToolDTO({
      id: askAboutImageToolId,
      name: 'ask_about_image',
      embedded: true,
      status: 'enabled',
      permission: 'public',
      uploader: systemUser,
      description: '按引用ID查询聊天中模型看不到的图片（[图片 ref:xxx]），支持定向提问；工具产出的图片请用 look_at_image',
      code: askAboutImageToolCode
    }))
  }

  // 注册内置的 look_at_image 工具：查看工具产出的图片（t_ 前缀 ref）
  const lookAtImageToolId = md5('look_at_image')
  const lookAtImageToolCode = readEmbeddedCode(resourcesDir, 'LookAtImage')
  const storedLookAtImageTool = await toolManager.getInstanceT(lookAtImageToolId)
  const loadedLookAtImageTool = await toolManager.getInstance('look_at_image')
  if (!storedLookAtImageTool || storedLookAtImageTool.code !== lookAtImageToolCode || !loadedLookAtImageTool) {
    logger.info('初始化内置的 look_at_image 工具')
    await toolManager.addInstance(new ToolDTO({
      id: lookAtImageToolId,
      name: 'look_at_image',
      embedded: true,
      status: 'enabled',
      permission: 'public',
      uploader: systemUser,
      description: '查看工具返回的图片内容（形如 t_xxx 的 ref），交给识图渠道并返回描述；仅在模型需要了解图片内容时调用',
      code: lookAtImageToolCode
    }))
  }

  const resolveImageRefToolId = md5('resolve_image_ref')
  const resolveImageRefToolCode = readEmbeddedCode(resourcesDir, 'ResolveImageRef')
  const storedResolveImageRefTool = await toolManager.getInstanceT(resolveImageRefToolId)
  const loadedResolveImageRefTool = await toolManager.getInstance('resolve_image_ref')
  if (!storedResolveImageRefTool || storedResolveImageRefTool.code !== resolveImageRefToolCode || !loadedResolveImageRefTool) {
    logger.info('init embedded resolve_image_ref tool')
    await toolManager.addInstance(new ToolDTO({
      id: resolveImageRefToolId,
      name: 'resolve_image_ref',
      embedded: true,
      status: 'enabled',
      permission: 'public',
      uploader: systemUser,
      description: 'Resolve image ref to original image URL for image processing tools',
      code: resolveImageRefToolCode
    }))
  }

  // 注册内置的 QQ 头像工具。头像不会由预处理器自动引入，只有模型明确需要时才调用。
  const getQQAvatarToolId = md5('GetQQAvatar')
  const getQQAvatarToolCode = readEmbeddedCode(resourcesDir, 'GetQQAvatar')
  const storedGetQQAvatarTool = await toolManager.getInstanceT(getQQAvatarToolId)
  const loadedGetQQAvatarTool = await toolManager.getInstance('GetQQAvatar')
  if (!storedGetQQAvatarTool || storedGetQQAvatarTool.code !== getQQAvatarToolCode || !loadedGetQQAvatarTool) {
    logger.info('初始化内置的 GetQQAvatar 工具')
    await toolManager.addInstance(new ToolDTO({
      id: getQQAvatarToolId,
      name: 'GetQQAvatar',
      embedded: true,
      status: 'enabled',
      permission: 'public',
      uploader: systemUser,
      description: '按需获取 QQ 头像并返回图片 ref；支持机器人头像、当前消息被 @ 用户头像和直接发送头像',
      code: getQQAvatarToolCode
    }))
  }

  // 将 ask_about_image 加入默认工具组
  if (await toolGroupsManager.getInstance('default_local')) {
    const defaultGroup = await toolGroupsManager.getInstance('default_local')
    if (defaultGroup && !defaultGroup.toolIds.includes(askAboutImageToolId)) {
      defaultGroup.toolIds.push(askAboutImageToolId)
      await toolGroupsManager.upsertInstance(defaultGroup)
    }
    if (defaultGroup && !defaultGroup.toolIds.includes(lookAtImageToolId)) {
      defaultGroup.toolIds.push(lookAtImageToolId)
      await toolGroupsManager.upsertInstance(defaultGroup)
    }
    if (defaultGroup && !defaultGroup.toolIds.includes(resolveImageRefToolId)) {
      defaultGroup.toolIds.push(resolveImageRefToolId)
      await toolGroupsManager.upsertInstance(defaultGroup)
    }
    if (defaultGroup && !defaultGroup.toolIds.includes(getQQAvatarToolId)) {
      defaultGroup.toolIds.push(getQQAvatarToolId)
      await toolGroupsManager.upsertInstance(defaultGroup)
    }
  }

  logger.info('初始化内置的工具组')
  logger.debug('数据库初始化完成')
}
