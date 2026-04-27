import { handleMbcProxyRequest } from './_lib/radioProxy.js'

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.statusCode = 405
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: 'Method not allowed.' }))
    return
  }

  await handleMbcProxyRequest(response, request.query ?? {})
}
