import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import {
  handleKbsProxyRequest,
  handleMbcProxyRequest,
  handleOptionsRequest,
  readRadioApiQuery,
} from './api/_lib/radioProxy.js'

function radioApiDevPlugin() {
  return {
    name: 'radio-api-dev-plugin',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url) {
          next()
          return
        }

        if (request.url.startsWith('/api/') && handleOptionsRequest(request, response)) {
          return
        }

        if (request.url.startsWith('/api/kbs')) {
          const { channelCode } = readRadioApiQuery(request.url)
          await handleKbsProxyRequest(response, channelCode)
          return
        }

        if (request.url.startsWith('/api/mbc')) {
          const { agent, channel } = readRadioApiQuery(request.url)
          await handleMbcProxyRequest(response, { agent, channel })
          return
        }

        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), radioApiDevPlugin()],
})
