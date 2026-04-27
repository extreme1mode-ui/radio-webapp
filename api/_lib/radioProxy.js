const KBS_BASE_URL = 'https://cfpwwwapi.kbs.co.kr'
const MBC_BASE_URL = 'https://sminiplay.imbc.com'

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Cache-Control', 'no-store')
}

function sendJson(response, statusCode, payload) {
  setCorsHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function normalizeQueryValue(value, fallbackValue) {
  if (Array.isArray(value)) {
    return value[0] ?? fallbackValue
  }

  return value ?? fallbackValue
}

export function handleOptionsRequest(request, response) {
  if (request.method !== 'OPTIONS') {
    return false
  }

  setCorsHeaders(response)
  response.statusCode = 204
  response.end()
  return true
}

export function findServiceUrlDeep(value) {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  if (typeof value.service_url === 'string' && value.service_url.trim()) {
    return value.service_url.trim()
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedMatch = findServiceUrlDeep(item)

      if (nestedMatch) {
        return nestedMatch
      }
    }

    return undefined
  }

  for (const nestedValue of Object.values(value)) {
    const nestedMatch = findServiceUrlDeep(nestedValue)

    if (nestedMatch) {
      return nestedMatch
    }
  }

  return undefined
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

export async function handleKbsProxyRequest(response, channelCode = '24') {
  const normalizedChannelCode = String(channelCode).trim() || '24'
  const upstreamUrl = getKbsUpstreamUrl(normalizedChannelCode)

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        accept: 'application/json',
      },
    })

    if (!upstreamResponse.ok) {
      sendJson(response, upstreamResponse.status, {
        ok: false,
        error: `KBS upstream request failed with status ${upstreamResponse.status}.`,
      })
      return
    }

    const data = await upstreamResponse.json()
    const directServiceUrl = data?.channel?.item?.[0]?.service_url?.trim()
    const fallbackServiceUrl = findServiceUrlDeep(data)
    const streamUrl = directServiceUrl || fallbackServiceUrl

    if (!streamUrl) {
      sendJson(response, 502, {
        ok: false,
        error: 'KBS stream URL could not be found.',
      })
      return
    }

    sendJson(response, 200, {
      ok: true,
      streamUrl,
    })
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'KBS upstream request failed.',
    })
  }
}

export async function handleMbcProxyRequest(response, options = {}) {
  const agent = String(normalizeQueryValue(options.agent, 'webapp')).trim() || 'webapp'
  const channel = String(normalizeQueryValue(options.channel, 'mfm')).trim() || 'mfm'
  const upstreamUrl = getMbcUpstreamUrl({ agent, channel })

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        accept: 'text/plain',
      },
    })

    if (!upstreamResponse.ok) {
      sendJson(response, upstreamResponse.status, {
        ok: false,
        error: `MBC upstream request failed with status ${upstreamResponse.status}.`,
      })
      return
    }

    const streamUrl = (await upstreamResponse.text()).trim().replace(/^"+|"+$/g, '')

    if (!streamUrl) {
      sendJson(response, 502, {
        ok: false,
        error: 'MBC stream URL could not be found.',
      })
      return
    }

    sendJson(response, 200, {
      ok: true,
      streamUrl,
    })
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'MBC upstream request failed.',
    })
  }
}

export function readRadioApiQuery(requestUrl) {
  const url = new URL(requestUrl, 'http://localhost')

  return {
    channelCode: url.searchParams.get('channelCode') ?? '24',
    agent: url.searchParams.get('agent') ?? 'webapp',
    channel: url.searchParams.get('channel') ?? 'mfm',
  }
}
