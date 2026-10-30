import Config from './config/config.js'

export function supportGuoba() {
  return {
    pluginInfo: {
      name: 'chatgpt-plugin',
      title: 'ChatGPT-Plugin (Chaite 2.0)',
      author: '@syfantasy',
      authorLink: 'https://github.com/syfantasy',
      link: 'https://github.com/syfantasy/chatgpt-plugin',
      isV3: false,
      isV4: true,
      description: '基于 Chaite 2.0 智能体架构的 Yunzai-Bot 极轻量对话与管理插件',
      icon: 'simple-icons:openai',
      iconColor: '#10a37f',
    },
    configInfo: {
      schemas: [
        {
          field: 'basic.toggleMode',
          label: '对话触发模式',
          bottomHelpMessage: '设置在群聊中触发机器人对话的方式',
          component: 'Select',
          componentProps: {
            options: [
              { label: '@机器人 触发 (at)', value: 'at' },
              { label: '指定前缀触发 (prefix)', value: 'prefix' },
              { label: '二者皆可 (both)', value: 'both' },
            ],
          },
        },
        {
          field: 'basic.togglePrefix',
          label: '对话触发前缀',
          bottomHelpMessage: '前缀触发模式下识别的起始字符',
          component: 'Input',
        },
        {
          field: 'basic.commandPrefix',
          label: '指令命令前缀',
          bottomHelpMessage: '管理指令识别前缀，默认为 #chatgpt',
          component: 'Input',
        },
        {
          field: 'basic.enableGroupContext',
          label: '自动记录群聊流水',
          bottomHelpMessage: '开启后将群消息旁路同步至 Chaite 建立带流动序号和花名册的上下文',
          component: 'Switch',
        },
        {
          field: 'chaite.url',
          label: 'Chaite 服务端地址',
          bottomHelpMessage: '新版 Chaite 2.0 服务端监听地址，默认 http://127.0.0.1:48370',
          component: 'Input',
        },
        {
          field: 'chaite.token',
          label: 'Chaite 管理密码 / Token',
          bottomHelpMessage: 'Chaite 控制台的访问密码或 Bearer Token',
          component: 'InputPassword',
        },
        {
          field: 'chaite.defaultPreset',
          label: '默认预设 ID',
          bottomHelpMessage: '留空则使用 Chaite 端内默认配置预设',
          component: 'Input',
        },
        {
          field: 'bym.enable',
          label: '伪人插话模式',
          bottomHelpMessage: '结合上下文自发参与群聊插话',
          component: 'Switch',
        },
        {
          field: 'bym.probability',
          label: '伪人随机触发概率',
          bottomHelpMessage: '0 ~ 1 之间的小数，如 0.02 表示 2% 概率',
          component: 'InputNumber',
          componentProps: {
            min: 0,
            max: 1,
            step: 0.01,
          },
        },
      ],
      getConfigData() {
        return {
          'basic.toggleMode': Config.basic.toggleMode,
          'basic.togglePrefix': Config.basic.togglePrefix,
          'basic.commandPrefix': Config.basic.commandPrefix,
          'basic.enableGroupContext': Config.basic.enableGroupContext,
          'chaite.url': Config.chaite.url,
          'chaite.token': Config.chaite.token,
          'chaite.defaultPreset': Config.chaite.defaultPreset,
          'bym.enable': Config.bym.enable,
          'bym.probability': Config.bym.probability,
        }
      },
      setConfigData(data, { Result }) {
        if (data['basic.toggleMode'] !== undefined) Config.basic.toggleMode = data['basic.toggleMode']
        if (data['basic.togglePrefix'] !== undefined) Config.basic.togglePrefix = data['basic.togglePrefix']
        if (data['basic.commandPrefix'] !== undefined) Config.basic.commandPrefix = data['basic.commandPrefix']
        if (data['basic.enableGroupContext'] !== undefined) Config.basic.enableGroupContext = data['basic.enableGroupContext']
        if (data['chaite.url'] !== undefined) Config.chaite.url = data['chaite.url']
        if (data['chaite.token'] !== undefined) Config.chaite.token = data['chaite.token']
        if (data['chaite.defaultPreset'] !== undefined) Config.chaite.defaultPreset = data['chaite.defaultPreset']
        if (data['bym.enable'] !== undefined) Config.bym.enable = data['bym.enable']
        if (data['bym.probability'] !== undefined) Config.bym.probability = data['bym.probability']

        Config.saveToFile()
        return Result.ok({}, 'Chaite 配置保存成功！')
      },
    },
  }
}
