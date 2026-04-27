const KBS_BASE_URL = 'https://cfpwwwapi.kbs.co.kr'
const MBC_BASE_URL = 'https://sminiplay.imbc.com'

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

function sendText(response, statusCode, body, contentType) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', contentType)
  response.setHeader('Cache-Control', 'no-store')
  response.end(body)
}

function getQueryValue(value, fallbackValue) {
  if (Array.isArray(value)) {
    return value[0] ?? fallbackValue
  }

  return value ?? fallbackValue
}

export function getKbsUpstreamUrl(channelCode = '24') {
  return `${KBS_BASE_URL}/api/v1/landing/live/channel_code/${channelCode}`
}

export function getMbcUpstreamUrl({
  agent = 'webapp',
  channel = 'mfm',
} = {}) {
  const searchParams = new URLSearchParams({
    agent,
    channel,
  })

  return `${MBC_BASE_URL}/aacplay.ashx?${searchParams.toString()}`
}

async function proxyUpstreamRequest(response, {
  upstreamUrl,
  contentType,
}) {
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        accept: contentType,
      },
    })
    const body = await upstreamResponse.text()

    sendText(
      response,
      upstreamResponse.status,
      body,
      upstreamResponse.headers.get('content-type') ?? contentType,
    )
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : 'Upstream radio service request failed.',
    })
  }
}

export async function handleKbsProxyRequest(response, channelCode = '24') {
  const normalizedChannelCode = String(channelCode).trim() || '24'

  await proxyUpstreamRequest(response, {
    upstreamUrl: getKbsUpstreamUrl(normalizedChannelCode),
    contentType: 'application/json; charset=utf-8',
  })
}

export async function handleMbcProxyRequest(response, options = {}) {
  const agent = String(getQueryValue(options.agent, 'webapp')).trim() || 'webapp'
  const channel = String(getQueryValue(options.channel, 'mfm')).trim() || 'mfm'

  await proxyUpstreamRequest(response, {
    upstreamUrl: getMbcUpstreamUrl({ agent, channel }),
    contentType: 'text/plain; charset=utf-8',
  })
}

export function readRadioApiQuery(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost')

  return {
    channelCode: url.searchParams.get('channelCode') ?? '24',
    agent: url.searchParams.get('agent') ?? 'webapp',
    channel: url.searchParams.get('channel') ?? 'mfm',
  }
}
