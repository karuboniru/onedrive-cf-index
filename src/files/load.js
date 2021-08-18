import config from '../config/default'
import { getAccessToken } from '../auth/onedrive'

/**
 * Cloudflare cache instance
 */
const cache = caches.default

async function fetchWithRange(downloadUrl, request) {
  var reqHeaders = new Headers();
  request.headers.get('range') ? reqHeaders.append('Range', request.headers.get('range')) : false
  request.headers.get('If-Match') ? reqHeaders.append('If-Match', request.headers.get('If-Match')) : false
  request.headers.get('If-Modified-Since') ? reqHeaders.append('If-Modified-Since', request.headers.get('If-Modified-Since')) : false
  request.headers.get('If-Range') ? reqHeaders.append('If-Range', request.headers.get('If-Range')) : false
  return fetch(downloadUrl, { headers: reqHeaders })
}

/**
 * Cache downloadUrl according to caching rules.
 * @param {Request} request client's request
 * @param {integer} fileSize
 * @param {string} downloadUrl
 * @param {function} fallback handle function if the rules is not satisfied
 */
async function setCache(request, fileSize, downloadUrl, fallback) {
  const range = request.headers.get('range')
  if (range) {
    console.info(`No cache ${request.url} because with range`)
    return await fallback(downloadUrl, request)
  }
  if (fileSize < config.cache.entireFileCacheLimit) {
    console.info(`Cache entire file ${request.url}`)
    const remoteResp = await fetch(downloadUrl)
    var repHeaders = new Headers();
    remoteResp.headers.get('Content-Type') ? repHeaders.append('Content-Type', remoteResp.headers.get('Content-Type')) : false
    remoteResp.headers.get('Content-Length') ? repHeaders.append('Content-Length', remoteResp.headers.get('Content-Length')) : false
    remoteResp.headers.get('Content-Disposition') ? repHeaders.append('Content-Disposition', remoteResp.headers.get('Content-Disposition')) : false
    remoteResp.headers.get('Accept-Ranges') ? repHeaders.append('Accept-Ranges', remoteResp.headers.get('Accept-Ranges')) : false
    remoteResp.headers.get('Content-Range') ? repHeaders.append('Content-Range', remoteResp.headers.get('Content-Range')) : false
    repHeaders.append('x-Provider', 'fullCache')
    const resp = new Response(remoteResp.body, {
      headers: repHeaders,
      status: remoteResp.status,
      statusText: remoteResp.statusText
    })
    await cache.put(request, resp.clone())
    return resp
  } else if (fileSize < config.cache.chunkedCacheLimit) {
    console.info(`Chunk cache file ${request.url}`)
    const remoteResp = await fetch(downloadUrl)
    const { readable, writable } = new TransformStream()
    remoteResp.body.pipeTo(writable)
    var repHeaders = new Headers();
    remoteResp.headers.get('Content-Type') ? repHeaders.append('Content-Type', remoteResp.headers.get('Content-Type')) : false
    remoteResp.headers.get('Content-Length') ? repHeaders.append('Content-Length', remoteResp.headers.get('Content-Length')) : false
    remoteResp.headers.get('Content-Disposition') ? repHeaders.append('Content-Disposition', remoteResp.headers.get('Content-Disposition')) : false
    remoteResp.headers.get('Accept-Ranges') ? repHeaders.append('Accept-Ranges', remoteResp.headers.get('Accept-Ranges')) : false
    remoteResp.headers.get('Content-Range') ? repHeaders.append('Content-Range', remoteResp.headers.get('Content-Range')) : false
    repHeaders.append('x-Provider', 'chunkCache')
    repHeaders.append('ETag', remoteResp.headers.get('ETag'))
    const resp = new Response(readable, {
      headers: repHeaders,
      status: remoteResp.status,
      statusText: remoteResp.statusText
    })
    await cache.put(request, resp.clone())
    return resp
  } else {
    console.info(`No cache ${request.url} because file_size(${fileSize}) > limit(${config.cache.chunkedCacheLimit})`)
    return await fallback(downloadUrl, request)
  }
}

/**
 * Redirect to the download url.
 * @param {string} downloadUrl
 */
async function directDownload(downloadUrl, request) {
  console.info(`DirectDownload -> ${downloadUrl}`)
  return new Response(null, {
    status: 302,
    headers: {
      Location: downloadUrl.slice(6)
    }
  })
}

/**
 * Download a file using Cloudflare as a relay.
 * @param {string} downloadUrl
 */
async function proxiedDownload(downloadUrl, request) {
  console.info(`ProxyDownload -> ${downloadUrl}`)
  const remoteResp = await fetchWithRange(downloadUrl, request)
  var repHeaders = new Headers();
  remoteResp.headers.get('Content-Type') ? repHeaders.append('Content-Type', remoteResp.headers.get('Content-Type')) : false
  remoteResp.headers.get('Content-Length') ? repHeaders.append('Content-Length', remoteResp.headers.get('Content-Length')) : false
  remoteResp.headers.get('Content-Disposition') ? repHeaders.append('Content-Disposition', remoteResp.headers.get('Content-Disposition')) : false
  remoteResp.headers.get('Accept-Ranges') ? repHeaders.append('Accept-Ranges', remoteResp.headers.get('Accept-Ranges')) : false
  remoteResp.headers.get('Content-Range') ? repHeaders.append('Content-Range', remoteResp.headers.get('Content-Range')) : false
  repHeaders.append('x-Provider', 'proxiedDownload')
  repHeaders.append('ETag', remoteResp.headers.get('ETag'))
  return new Response(remoteResp.body, { headers: repHeaders, status: remoteResp.status, statusText: remoteResp.statusText })
}

export async function handleFile(request, pathname, downloadUrl, { proxied = false, fileSize = 0 }) {
  if (config.cache && config.cache.enable && config.cache.paths.filter(p => pathname.startsWith(p)).length > 0) {
    return setCache(request, fileSize, downloadUrl, proxied ? proxiedDownload : directDownload)
  }
  return (proxied ? proxiedDownload : directDownload)(downloadUrl, request)
}

export async function handleUpload(request, pathname, filename) {
  const url = `${config.apiEndpoint.graph}/me/drive/root:${encodeURI(config.base) +
    (pathname.slice(-1) === '/' ? pathname : pathname + '/')}${filename}:/content`
  return await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `bearer ${await getAccessToken()}`,
      ...request.headers
    },
    body: request.body
  })
}
