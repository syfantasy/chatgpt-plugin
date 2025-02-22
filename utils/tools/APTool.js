import { AbstractTool } from './AbstractTool.js'

export class APTool extends AbstractTool {
  name = 'draw'

  parameters = {
    properties: {
      prompt: {
        type: 'string',
        description: 'draw prompt of midjourney, prefer to be in English. should be many keysentences split by comma.'
      }
    },
    required: []
  }

  description = 'Useful when you want to draw picture'

  func = async function (opts, e) {
    let { prompt } = opts
    if (e.at === e.bot.uin) {
      e.at = null
    }
    e.atBot = false
    let ap
    try {
      // eslint-disable-next-line camelcase
      let { MJ_Painting } = await import('../../../siliconflow-plugin/apps/MJ_Painting.js')
      ap = new MJ_Painting(e)
    } catch (err) {
      try {
        // ap的dev分支改名了
        // eslint-disable-next-line camelcase
        let { MJ_Painting } = await import('../../../siliconflow-plugin/apps/MJ_Painting.js')
        ap = new MJ_Painting(e)
      } catch (err1) {
        return 'the user didn\'t install sf-plugin. suggest him to install'
      }
    }
    try {
      e.msg = '#mjp' + prompt
      await ap.mj_draw(e)
      return 'draw success, picture has been sent.'
    } catch (err) {
      return 'draw failed due to unknown error'
    }
  }
}
