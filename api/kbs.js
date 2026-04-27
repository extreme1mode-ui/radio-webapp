import {
  handleKbsProxyRequest,
  handleOptionsRequest,
} from './_lib/radioProxy.js'

export default async function handler(request, response) {
  if (handleOptionsRequest(request, response)) {
    return
  }

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET, OPTIONS')
    response.statusCode = 405
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ ok: false, error: 'Method not allowed.' }))
    return
  }

  await handleKbsProxyRequest(response, request.query?.channelCode ?? '24')
}
