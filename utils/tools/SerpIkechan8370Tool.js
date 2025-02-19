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
    required: ['q']
  }

  func = async function (opts) {
    try {
      let { q, source = 'bing', num = 5 } = opts
      
      if (!['google', 'bing', 'baidu', 'duckduckgo'].includes(source)) {
        source = 'bing'
      }

      const url = `https://serp.ikechan8370.com/${source}?q=${encodeURIComponent(q)}&lang=zh-CN&limit=${num}`
      
      const response = await fetch(url, {
        headers: {
          'X-From-Library': 'ikechan8370'
        }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const serpRes = await response.json()
      let res = serpRes.data || serpRes.results
      
      if (!res) {
        throw new Error('No results found in response')
      }
      
      // 移除每个结果中的 rank 字段
      res = res.map(item => {
        const { rank, ...rest } = item
        return rest
      })
      
      return `the search results are here in json format:\n${JSON.stringify(res, null, 2)} \n(Notice that these information are only available for you, the user cannot see them, you next answer should consider about the information)`
    } catch (error) {
      console.error('Search error:', error)
      return `Error during search: ${error.message}`
    }
  }

  description = 'Useful when you want to search something from the Internet. If you don\'t know much about the user\'s question, prefer to search about it! If you want to know further details of a result, you can use website tool'
}
