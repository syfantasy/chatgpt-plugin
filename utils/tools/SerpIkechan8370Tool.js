import { AbstractTool } from './AbstractTool.js'
import fetch from 'node-fetch'

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

    try {
      const url = `https://serp.ikechan8370.com/${source}?q=${encodeURIComponent(q)}&lang=zh-CN&limit=${num}`
      console.log('Requesting URL:', url) // 调试用

      const response = await fetch(url, {
        headers: {
          'X-From-Library': 'ikechan8370'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const serpRes = await response.json()
      console.log('API Response:', serpRes) // 调试用

      let res = serpRes.data || serpRes.results
      if (!res) {
        console.error('No data found in response:', serpRes)
        return 'Sorry, no search results found.'
      }

      res?.forEach(r => {
        delete r?.rank
      })

      return `the search results are here in json format:\n${JSON.stringify(res)} \n(Notice that these information are only available for you, the user cannot see them, you next answer should consider about the information)`
    } catch (error) {
      console.error('Search error:', error)
      return `An error occurred during search: ${error.message}`
    }
  }

  description = 'Useful when you want to search something from the Internet. If you don\'t know much about the user\'s question, prefer to search about it! If you want to know further details of a result, you can use website tool'
}
