import { AbstractTool } from './AbstractTool.js'

export class SerpIkechan8370Tool extends AbstractTool {
  name = 'search'

  parameters = {
    properties: {
      q: {
        type: 'string',
        description: 'search keyword'
      },
      source: {
        type: 'string',
        enum: ['bing', 'google', 'baidu', 'duckduckgo'],
        description: 'search source, default value is bing'
      },
      num: {
        type: 'number',
        description: 'search results limit number, default is 5'
      }
    },
    required: ['q', 'source']
  }

func = async function (opts) {
    let { q, source, num = 5 } = opts
    if (!source || !['google', 'bing', 'baidu', 'duckduckgo'].includes(source)) {
      source = 'bing'
    }

    return new Promise((resolve, reject) => {
      const https = require('https')
      const url = `https://serp.ikechan8370.com/${source}?q=${encodeURIComponent(q)}&lang=zh-CN&limit=${num}`
      
      https.get(url, {
        headers: {
          'X-From-Library': 'ikechan8370'
        }
      }, (resp) => {
        let data = ''
        
        resp.on('data', (chunk) => {
          data += chunk
        })
        
        resp.on('end', () => {
          try {
            const serpRes = JSON.parse(data)
            let res = serpRes.data || serpRes.results
            res?.forEach(r => {
              delete r?.rank
            })
            resolve(`the search results are here in json format:\n${JSON.stringify(res)} \n(Notice that these information are only available for you, the user cannot see them, you next answer should consider about the information)`)
          } catch (error) {
            reject(error)
          }
        })
      }).on('error', (err) => {
        reject(err)
      })
    })
}

  description = 'Useful when you want to search something from the Internet. If you don\'t know much about the user\'s question, prefer to search about it! If you want to know further details of a result, you can use website tool'
}
