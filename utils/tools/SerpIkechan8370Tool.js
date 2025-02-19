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
      
      // 检查响应状态码
      if (serpRes.code !== 200) {
        throw new Error(`API error: ${serpRes.message}`)
      }

      // 确保 data 字段存在且为数组
      if (!serpRes.data || !Array.isArray(serpRes.data)) {
        throw new Error('Invalid response format: data field missing or not an array')
      }

      // 处理数据，移除 rank 字段
      const results = serpRes.data.map(({ rank, ...item }) => item)
      
      if (results.length === 0) {
        return 'No search results found.'
      }
      
      return `the search results are here in json format:\n${JSON.stringify(results, null, 2)} \n(Notice that these information are only available for you, the user cannot see them, you next answer should consider about the information)`
    } catch (error) {
      console.error('Search error:', error)
      return `An error occurred during search. Please try again later. (Error: ${error.message})`
    }
  }

  description = 'Useful when you want to search something from the Internet. If you don\'t know much about the user\'s question, prefer to search about it! If you want to know further details of a result, you can use website tool'
}
