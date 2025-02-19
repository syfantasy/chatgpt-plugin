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
      // 过滤掉非搜索相关的参数
      const { q, source = 'bing', num = 5 } = {
        q: opts.q,
        source: opts.source,
        num: opts.num
      }
      
      if (!['google', 'bing', 'baidu', 'duckduckgo'].includes(source)) {
        source = 'bing'
      }

      const url = `https://serp.ikechan8370.com/${source}?q=${encodeURIComponent(q)}&lang=zh-CN&limit=${num}`
      console.log('Request URL:', url)
      
      const response = await fetch(url, {
        headers: {
          'X-From-Library': 'ikechan8370',
          'Accept': 'application/json'
        }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const responseText = await response.text()
      console.log('Raw response:', responseText)
      
      let serpRes
      try {
        serpRes = JSON.parse(responseText)
      } catch (e) {
        throw new Error(`Failed to parse JSON response: ${e.message}`)
      }
      
      console.log('Parsed response:', serpRes)

      // 尝试从不同位置获取结果数组
      let results = serpRes.data || serpRes.results || serpRes
      
      // 如果结果不是数组，尝试将其转换为数组
      if (!Array.isArray(results)) {
        if (typeof results === 'object') {
          results = [results]
        } else {
          results = []
        }
      }
      
      // 移除 rank 字段并清理数据
      results = results.map(item => {
        if (typeof item !== 'object' || item === null) {
          return { content: String(item) }
        }
        const { rank, ...rest } = item
        return rest
      })
      
      if (results.length === 0) {
        return 'No search results found.'
      }
      
      return `the search results are here in json format:\n${JSON.stringify(results, null, 2)} \n(Notice that these information are only available for you, the user cannot see them, you next answer should consider about the information)`
    } catch (error) {
      console.error('Search error:', error)
      // 返回更详细的错误信息
      return `An error occurred during search. Please try again later. (Error: ${error.message})\nStack: ${error.stack}`
    }
  }

  description = 'Useful when you want to search something from the Internet. If you don\'t know much about the user\'s question, prefer to search about it! If you want to know further details of a result, you can use website tool'
}
