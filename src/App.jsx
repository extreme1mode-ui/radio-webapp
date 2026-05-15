import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import './App.css'
import volumeHighIcon from './assets/icons/volume-high.svg'
import volumeLowIcon from './assets/icons/volume-low.svg'
import { stations } from './stations'

const TUNER_STEP = 0.1
const TUNER_PIXELS_PER_STEP = 10
const TUNER_EDGE_PADDING = 1.5
const TUNER_SNAP_DELAY = 120
const TUNER_SNAP_THRESHOLD_MHZ = 0.3
const TUNER_SNAP_ANIMATION_MS = 180
const DEFAULT_VOLUME = 0.16
const STREAM_UNAVAILABLE_MESSAGE = 'Stream is not available yet.'

const speakerPattern = [
  ['dark', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light'],
  ['dark', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light'],
  ['dark', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light'],
  ['dark', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light'],
  ['empty', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'empty'],
]
const SPEAKER_COLUMNS = speakerPattern[0].length

function stationHasSourceConfig(station) {
  if (!station.isPlayable) {
    return false
  }

  if (station.streamType === 'direct') {
    return Boolean(station.streamUrl?.trim())
  }

  if (station.streamType === 'json-api' || station.streamType === 'plain-text-api') {
    return Boolean(station.apiUrl?.trim())
  }

  return false
}

function isHlsStream(url) {
  return url.toLowerCase().includes('.m3u8')
}

function isValidStreamUrl(url) {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
  } catch {
    return false
  }
}

async function resolveStreamUrl(station) {
  console.log('[STREAM] resolving station:', {
    stationId: station.id,
    streamType: station.streamType,
  })

  if (!station.isPlayable || !station.streamType || station.streamType === 'unavailable') {
    throw new Error(STREAM_UNAVAILABLE_MESSAGE)
  }

  if (station.streamType === 'direct') {
    const directUrl = station.streamUrl?.trim() ?? ''

    if (!directUrl) {
      throw new Error('Stream URL is not available.')
    }

    if (!isValidStreamUrl(directUrl)) {
      throw new Error('The direct stream URL is missing or invalid.')
    }

    console.log('[STREAM] resolved station:', {
      stationId: station.id,
      streamType: station.streamType,
      finalResolvedStreamUrl: directUrl,
    })
    return directUrl
  }

  if (!station.apiUrl) {
    throw new Error('Stream URL is not available.')
  }

  let response

  try {
    response = await fetch(station.apiUrl)
  } catch {
    throw new Error(
      'The stream information could not be loaded. The station may block browser access or the network may be unavailable.',
    )
  }

  if (!response.ok) {
    throw new Error('The station stream information could not be loaded right now.')
  }

  if (station.streamType === 'json-api') {
    const json = await response.json()

    if (station.apiUrl.startsWith('/api/kbs')) {
      console.log('[API] KBS proxy response:', json)
    }

    if (station.apiUrl.startsWith('/api/mbc')) {
      console.log('[API] MBC proxy response:', json)
    }

    if (!json?.ok) {
      throw new Error(json?.error || 'The station API could not provide a stream URL.')
    }

    const streamUrl = json.streamUrl?.trim() ?? ''

    if (!streamUrl) {
      throw new Error('The station API returned an empty stream URL.')
    }

    if (!isValidStreamUrl(streamUrl)) {
      throw new Error('The station API returned an invalid stream URL.')
    }

    console.log('[STREAM] resolved station:', {
      stationId: station.id,
      streamType: station.streamType,
      finalResolvedStreamUrl: streamUrl,
    })
    return streamUrl
  }

  if (station.streamType === 'plain-text-api') {
    const text = (await response.text()).trim().replace(/^"+|"+$/g, '')

    if (!text) {
      throw new Error('The station API returned an empty stream URL.')
    }

    if (!isValidStreamUrl(text)) {
      throw new Error('The station API returned an invalid stream URL.')
    }

    console.log('[STREAM] resolved station:', {
      stationId: station.id,
      streamType: station.streamType,
      finalResolvedStreamUrl: text,
    })
    return text
  }

  throw new Error('This station has an unsupported stream type.')
}

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // localStorage may be unavailable (private mode, etc.)
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('theme', theme)
    } catch {
      // ignore
    }
  }, [theme])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function handleChange(e) {
      try {
        if (localStorage.getItem('theme')) return
      } catch {
        // ignore
      }
      setTheme(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))

  return { theme, toggleTheme }
}

function App() {
  const { theme, toggleTheme } = useTheme()

  // Sort stations from low frequency to high frequency so the tuner order is correct.
  const sortedStations = [...stations].sort(
    (firstStation, secondStation) =>
      Number.parseFloat(firstStation.frequency) - Number.parseFloat(secondStation.frequency),
  )

  const [currentIndex, setCurrentIndex] = useState(0)
  const [visualFrequency, setVisualFrequency] = useState(
    Number.parseFloat(sortedStations[0].frequency),
  )
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isDialDragging, setIsDialDragging] = useState(false)
  const [volumeValue, setVolumeValue] = useState(DEFAULT_VOLUME)
  const [isVolumeDragging, setIsVolumeDragging] = useState(false)
  const [playbackMessage, setPlaybackMessage] = useState('')
  const audioRef = useRef(null)
  const hlsRef = useRef(null)
  const playRequestRef = useRef(0)
  const tunerViewportRef = useRef(null)
  const speakerGridRef = useRef(null)
  const tunerSnapTimeoutRef = useRef(null)
  const tunerCommitTimeoutRef = useRef(null)
  const volumeAnimationFrameRef = useRef(0)
  const activeVolumePointerIdRef = useRef(null)
  const activeVolumeTargetRef = useRef(null)
  const currentIndexRef = useRef(currentIndex)
  const visualFrequencyRef = useRef(visualFrequency)
  const volumeValueRef = useRef(volumeValue)
  const pendingVolumeRef = useRef(volumeValue)
  const isPlayingRef = useRef(isPlaying)
  const isLoadingRef = useRef(isLoading)
  const commitTunerSelectionRef = useRef(null)
  const hasCenteredInitialStationRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartScrollLeftRef = useRef(0)
  const isDialDraggingRef = useRef(false)

  const stationFrequencies = sortedStations.map((station) => Number.parseFloat(station.frequency))
  const scaleMin = Math.min(...stationFrequencies) - TUNER_EDGE_PADDING
  const scaleMax = Math.max(...stationFrequencies) + TUNER_EDGE_PADDING
  const scaleWidth =
    Math.round((scaleMax - scaleMin) / TUNER_STEP) * TUNER_PIXELS_PER_STEP
  const stationPositions = stationFrequencies.map(
    (frequency) => ((frequency - scaleMin) / TUNER_STEP) * TUNER_PIXELS_PER_STEP,
  )
  const dialTicks = Array.from(
    { length: Math.round((scaleMax - scaleMin) / TUNER_STEP) + 1 },
    (_, index) => ({
      id: index,
      left: index * TUNER_PIXELS_PER_STEP,
      isMajor: index % 5 === 0,
    }),
  )

  const currentStation = sortedStations[currentIndex]
  const snapThresholdPixels =
    (TUNER_SNAP_THRESHOLD_MHZ / TUNER_STEP) * TUNER_PIXELS_PER_STEP

  function destroyHlsPlayer() {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }

  useEffect(() => {
    currentIndexRef.current = currentIndex
  }, [currentIndex])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  useEffect(() => {
    visualFrequencyRef.current = visualFrequency
  }, [visualFrequency])

  useEffect(() => {
    volumeValueRef.current = volumeValue
  }, [volumeValue])

  useEffect(() => {
    isDialDraggingRef.current = isDialDragging
  }, [isDialDragging])

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    audio.volume = volumeValue
  }, [volumeValue])

  useEffect(() => {
    return () => {
      if (volumeAnimationFrameRef.current) {
        window.cancelAnimationFrame(volumeAnimationFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isVolumeDragging) {
      return undefined
    }

    function handleWindowPointerMove(event) {
      handleVolumePointerMove(event)
    }

    function handleWindowPointerEnd(event) {
      handleVolumePointerEnd(event)
    }

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: false })
    window.addEventListener('pointerup', handleWindowPointerEnd, { passive: false })
    window.addEventListener('pointercancel', handleWindowPointerEnd, { passive: false })

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerEnd)
      window.removeEventListener('pointercancel', handleWindowPointerEnd)
    }
  }, [isVolumeDragging])

  useEffect(() => {
    const audio = audioRef.current

    if (!audio) {
      return undefined
    }

    function handleLoadStart() {
      if (audio.currentSrc) {
        setIsLoading(true)
      }
    }

    function handlePlaying() {
      setIsLoading(false)
      setIsPlaying(true)
      setPlaybackMessage('')
    }

    function handlePause() {
      setIsLoading(false)
      setIsPlaying(false)
    }

    function handleWaiting() {
      if (!audio.paused) {
        setIsLoading(true)
      }
    }

    function handleEnded() {
      setIsLoading(false)
      setIsPlaying(false)
    }

    function handleError() {
      console.log('[AUDIO] error details:', {
        stationId: sortedStations[currentIndexRef.current]?.id,
        streamType: sortedStations[currentIndexRef.current]?.streamType,
        currentSrc: audio.currentSrc,
        errorCode: audio.error?.code,
        errorMessage: audio.error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
      })
      setIsLoading(false)
      setIsPlaying(false)
      setPlaybackMessage('The stream could not be played right now.')
    }

    audio.addEventListener('loadstart', handleLoadStart)
    audio.addEventListener('playing', handlePlaying)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('waiting', handleWaiting)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('loadstart', handleLoadStart)
      audio.removeEventListener('playing', handlePlaying)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('waiting', handleWaiting)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      destroyHlsPlayer()
    }
  }, [])

  function clampFrequency(frequency) {
    return Math.min(scaleMax - TUNER_EDGE_PADDING, Math.max(scaleMin + TUNER_EDGE_PADDING, frequency))
  }

  // Convert scroll position into a continuous frequency value for the top display.
  function scrollLeftToFrequency(scrollLeft) {
    return clampFrequency(scaleMin + (scrollLeft / TUNER_PIXELS_PER_STEP) * TUNER_STEP)
  }

  function getNearestStationIndexFromScroll(scrollLeft) {
    let nearestIndex = 0
    let smallestDistance = Infinity

    // Map the horizontal scroll position to the nearest station center.
    stationPositions.forEach((position, index) => {
      const distance = Math.abs(position - scrollLeft)

      if (distance < smallestDistance) {
        smallestDistance = distance
        nearestIndex = index
      }
    })

    return nearestIndex
  }

  function clearTunerTimeouts() {
    window.clearTimeout(tunerSnapTimeoutRef.current)
    window.clearTimeout(tunerCommitTimeoutRef.current)
  }

  function clampVolume(nextVolume) {
    return Math.min(1, Math.max(0, nextVolume))
  }

  function applyVolume(nextVolume) {
    const clampedVolume = clampVolume(nextVolume)
    const audio = audioRef.current

    pendingVolumeRef.current = clampedVolume

    if (audio) {
      audio.volume = clampedVolume
    }

    setVolumeValue(clampedVolume)
  }

  function scheduleVolumeUpdate(nextVolume) {
    pendingVolumeRef.current = clampVolume(nextVolume)

    if (volumeAnimationFrameRef.current) {
      return
    }

    volumeAnimationFrameRef.current = window.requestAnimationFrame(() => {
      volumeAnimationFrameRef.current = 0
      applyVolume(pendingVolumeRef.current)
    })
  }

  // Map the horizontal pointer position inside the grille directly to a 0-1 volume value.
  function getVolumeFromClientX(clientX) {
    const speakerGrid = speakerGridRef.current

    if (!speakerGrid) {
      return volumeValueRef.current
    }

    const { left, width } = speakerGrid.getBoundingClientRect()

    if (width <= 0) {
      return volumeValueRef.current
    }

    return clampVolume((clientX - left) / width)
  }

  function scheduleStationCommit(index) {
    window.clearTimeout(tunerCommitTimeoutRef.current)
    tunerCommitTimeoutRef.current = window.setTimeout(() => {
      commitTunerSelection(index)
      setVisualFrequency(stationFrequencies[index])
    }, TUNER_SNAP_ANIMATION_MS)
  }

  function scrollTunerToStation(index, behavior = 'smooth') {
    const tunerViewport = tunerViewportRef.current

    if (!tunerViewport) {
      return
    }

    tunerViewport.scrollTo({
      left: stationPositions[index],
      behavior,
    })
  }

  function commitTunerSelection(index) {
    const selectedStation = sortedStations[index]
    const shouldResumePlayback = isPlayingRef.current || isLoadingRef.current

    if (currentIndexRef.current === index) {
      return
    }

    setCurrentIndex(index)
    setPlaybackMessage('')

    if (shouldResumePlayback) {
      startPlayback(selectedStation)
      return
    }

    playRequestRef.current += 1
    clearAudioSource()
    setIsLoading(false)
    setIsPlaying(false)
  }

  useEffect(() => {
    commitTunerSelectionRef.current = commitTunerSelection
  })

  function snapTunerToNearestStation() {
    const tunerViewport = tunerViewportRef.current

    if (!tunerViewport) {
      return
    }

    const nearestIndex = getNearestStationIndexFromScroll(tunerViewport.scrollLeft)
    const targetScrollLeft = stationPositions[nearestIndex]
    const distanceToTarget = Math.abs(tunerViewport.scrollLeft - targetScrollLeft)

    // Snap only when the tuner rests close enough to a station frequency.
    if (distanceToTarget > snapThresholdPixels) {
      return
    }

    scrollTunerToStation(nearestIndex)
    scheduleStationCommit(nearestIndex)
  }

  function handleTunerScroll() {
    const tunerViewport = tunerViewportRef.current

    if (!tunerViewport) {
      return
    }

    setVisualFrequency(scrollLeftToFrequency(tunerViewport.scrollLeft))

    if (isDialDraggingRef.current) {
      return
    }

    window.clearTimeout(tunerSnapTimeoutRef.current)
    tunerSnapTimeoutRef.current = window.setTimeout(() => {
      snapTunerToNearestStation()
    }, TUNER_SNAP_DELAY)
  }

  function handleDialMouseDown(event) {
    const tunerViewport = tunerViewportRef.current

    if (!tunerViewport) {
      return
    }

    // Mouse dragging changes the horizontal scroll position directly.
    setIsDialDragging(true)
    dragStartXRef.current = event.clientX
    dragStartScrollLeftRef.current = tunerViewport.scrollLeft
    clearTunerTimeouts()
    event.preventDefault()
  }

  function handleDialMouseMove(event) {
    const tunerViewport = tunerViewportRef.current

    if (!tunerViewport || !isDialDraggingRef.current) {
      return
    }

    const dragDistance = event.clientX - dragStartXRef.current
    tunerViewport.scrollLeft = dragStartScrollLeftRef.current - dragDistance
    event.preventDefault()
  }

  function handleDialTouchStart() {
    clearTunerTimeouts()
  }

  function handleVolumePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    activeVolumePointerIdRef.current = event.pointerId
    activeVolumeTargetRef.current = event.currentTarget
    setIsVolumeDragging(true)

    if (event.currentTarget.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Mobile browsers can reject pointer capture in some edge cases.
      }
    }

    scheduleVolumeUpdate(getVolumeFromClientX(event.clientX))
    event.preventDefault()
  }

  function handleVolumePointerMove(event) {
    if (activeVolumePointerIdRef.current !== event.pointerId) {
      return
    }

    scheduleVolumeUpdate(getVolumeFromClientX(event.clientX))
    event.preventDefault()
  }

  function handleVolumePointerEnd(event) {
    if (activeVolumePointerIdRef.current !== event.pointerId) {
      return
    }

    scheduleVolumeUpdate(getVolumeFromClientX(event.clientX))

    if (
      activeVolumeTargetRef.current?.hasPointerCapture &&
      activeVolumeTargetRef.current.hasPointerCapture(event.pointerId)
    ) {
      activeVolumeTargetRef.current.releasePointerCapture(event.pointerId)
    }

    activeVolumePointerIdRef.current = null
    activeVolumeTargetRef.current = null
    setIsVolumeDragging(false)
    event.preventDefault()
  }

  function handleVolumeKeyDown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      scheduleVolumeUpdate(volumeValueRef.current - 0.05)
      event.preventDefault()
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      scheduleVolumeUpdate(volumeValueRef.current + 0.05)
      event.preventDefault()
    }

    if (event.key === 'Home') {
      scheduleVolumeUpdate(0)
      event.preventDefault()
    }

    if (event.key === 'End') {
      scheduleVolumeUpdate(1)
      event.preventDefault()
    }
  }

  function clearAudioSource() {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    destroyHlsPlayer()
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }

  async function attachResolvedStream(audio, streamUrl) {
    destroyHlsPlayer()

    if (isHlsStream(streamUrl)) {
      console.log('[HLS] Loading:', streamUrl)

      if (audio.canPlayType('application/vnd.apple.mpegurl')) {
        console.log('[HLS] Using native HLS playback')
        audio.src = streamUrl
        audio.load()
        return
      }

      if (Hls.isSupported()) {
        await new Promise((resolve, reject) => {
          const hls = new Hls()
          hlsRef.current = hls

          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            console.log('[HLS] MEDIA_ATTACHED')
            hls.loadSource(streamUrl)
          })

          hls.on(Hls.Events.MANIFEST_LOADING, () => {
            console.log('[HLS] MANIFEST_LOADING')
          })

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('[HLS] MANIFEST_PARSED')
            resolve()
          })

          hls.on(Hls.Events.LEVEL_LOADED, () => {
            console.log('[HLS] LEVEL_LOADED')
          })

          hls.on(Hls.Events.ERROR, (_, data) => {
            console.log('[HLS] ERROR:', data)

            if (!data.fatal) {
              return
            }

            hls.destroy()
            if (hlsRef.current === hls) {
              hlsRef.current = null
            }

            reject(
              new Error(
                'This HLS stream could not be played in this browser. It may be blocked or unsupported.',
              ),
            )
          })

          hls.attachMedia(audio)
        })
        return
      }

      throw new Error('This browser cannot play this HLS stream format.')
    }

    console.log('[AUDIO] Using direct stream:', streamUrl)
    audio.src = streamUrl
    audio.load()
  }

  function startPlayback(station) {
    const audio = audioRef.current
    const playRequestId = playRequestRef.current + 1

    if (!audio) {
      return
    }

    playRequestRef.current = playRequestId
    console.log('[PLAYBACK] request:', {
      stationId: station.id,
      streamType: station.streamType,
      isPlayable: station.isPlayable,
    })

    if (!stationHasSourceConfig(station)) {
      clearAudioSource()
      setIsLoading(false)
      setIsPlaying(false)
      setPlaybackMessage(STREAM_UNAVAILABLE_MESSAGE)
      return
    }

    setIsLoading(true)
    setIsPlaying(false)
    setPlaybackMessage('')

    ;(async () => {
      try {
        const streamUrl = await resolveStreamUrl(station)

        if (playRequestRef.current !== playRequestId) {
          return
        }

        if (!streamUrl) {
          throw new Error('Stream URL is not available.')
        }

        await attachResolvedStream(audio, streamUrl)

        if (playRequestRef.current !== playRequestId) {
          return
        }

        const playPromise = audio.play()

        if (playPromise) {
          await playPromise
        }
      } catch (error) {
        if (playRequestRef.current !== playRequestId) {
          return
        }

        clearAudioSource()
        setIsLoading(false)
        setIsPlaying(false)
        setPlaybackMessage(
          error instanceof Error && error.message
            ? error.message
            : 'The stream could not be played right now.',
        )
      }
    })()
  }

  function selectStation(nextIndex) {
    setVisualFrequency(stationFrequencies[nextIndex])
    // Previous and next buttons move to the next lower or higher snapped station.
    scrollTunerToStation(nextIndex)
    scheduleStationCommit(nextIndex)
  }

  function goToPreviousStation() {
    const nextIndex = currentIndex === 0 ? sortedStations.length - 1 : currentIndex - 1
    selectStation(nextIndex)
  }

  function goToNextStation() {
    const nextIndex = currentIndex === sortedStations.length - 1 ? 0 : currentIndex + 1
    selectStation(nextIndex)
  }

  function togglePlayback() {
    const audio = audioRef.current

    if (!audio) {
      return
    }

    if (isPlaying || isLoading) {
      playRequestRef.current += 1
      audio.pause()
      destroyHlsPlayer()
      setIsLoading(false)
      setPlaybackMessage('')
      return
    }

    startPlayback(currentStation)
  }

  useEffect(() => {
    const tunerViewport = tunerViewportRef.current

    if (!tunerViewport || hasCenteredInitialStationRef.current) {
      return
    }

    tunerViewport.scrollLeft = stationPositions[currentIndex]
    setVisualFrequency(stationFrequencies[currentIndex])
    hasCenteredInitialStationRef.current = true
  }, [currentIndex, stationFrequencies, stationPositions])

  useEffect(() => {
    if (!isDialDragging) {
      return undefined
    }

    function handleWindowMouseMove(event) {
      handleDialMouseMove(event)
    }

    function handleWindowMouseUp() {
      if (!isDialDraggingRef.current) {
        return
      }

      setIsDialDragging(false)

      const tunerViewport = tunerViewportRef.current

      if (!tunerViewport) {
        return
      }

      let nearestIndex = 0
      let smallestDistance = Infinity

      stationPositions.forEach((position, index) => {
        const distance = Math.abs(position - tunerViewport.scrollLeft)

        if (distance < smallestDistance) {
          smallestDistance = distance
          nearestIndex = index
        }
      })

      if (smallestDistance > snapThresholdPixels) {
        return
      }

      tunerViewport.scrollTo({
        left: stationPositions[nearestIndex],
        behavior: 'smooth',
      })

      window.clearTimeout(tunerCommitTimeoutRef.current)
      tunerCommitTimeoutRef.current = window.setTimeout(() => {
        commitTunerSelectionRef.current?.(nearestIndex)
        setVisualFrequency(stationFrequencies[nearestIndex])
      }, TUNER_SNAP_ANIMATION_MS)
    }

    // Keep mouse dragging 1:1 even when the cursor leaves the tuner element.
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [isDialDragging, snapThresholdPixels, stationFrequencies, stationPositions])

  useEffect(() => {
    function handleResize() {
      const tunerViewport = tunerViewportRef.current

      if (!tunerViewport) {
        return
      }

      const nextScrollLeft =
        ((Math.min(scaleMax - TUNER_EDGE_PADDING, Math.max(scaleMin + TUNER_EDGE_PADDING, visualFrequencyRef.current)) -
          scaleMin) /
          TUNER_STEP) *
        TUNER_PIXELS_PER_STEP

      tunerViewport.scrollTo({
        left: nextScrollLeft,
        behavior: 'auto',
      })
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      clearTunerTimeouts()
    }
  }, [scaleMax, scaleMin])

  return (
    <main className="app-shell">
      <section className="radio-app" aria-label="FM radio app">
        <header className="app-header">
          <div className="app-title">
            <span>FM RADIO</span>
            <ChevronIcon />
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>

        <section className="station-display" aria-label="Current station">
          <div className="frequency-readout">
            <span className="frequency-value">{visualFrequency.toFixed(1)}</span>
            <span className="frequency-unit">MHz</span>
          </div>
          <p className="station-name">
            {currentStation.name}
            {playbackMessage ? ` · ${playbackMessage}` : ''}
          </p>
        </section>

        <div className="bottom-section">
          <section className="dial-panel" aria-label="Station dial">
            <div
              ref={tunerViewportRef}
              className={`dial-viewport${isDialDragging ? ' dial-viewport-dragging' : ''}`}
              onScroll={handleTunerScroll}
              onMouseDown={handleDialMouseDown}
              onTouchStart={handleDialTouchStart}
            >
              <div className="dial-track">
                <div className="dial-scale-strip" style={{ width: `${scaleWidth}px` }}>
                  <div className="dial-scale dial-scale-top">
                    {dialTicks.map((tick) => (
                      <span
                        key={`top-${tick.id}`}
                        className={tick.isMajor ? 'dial-tick dial-tick-major' : 'dial-tick'}
                        style={{ left: `${tick.left}px` }}
                      />
                    ))}
                  </div>

                  <div className="dial-scale dial-scale-bottom">
                    {dialTicks.map((tick) => (
                      <span
                        key={`bottom-${tick.id}`}
                        className={tick.isMajor ? 'dial-tick dial-tick-major' : 'dial-tick'}
                        style={{ left: `${tick.left}px` }}
                      />
                    ))}
                  </div>

                  <div className="dial-labels" aria-hidden="true">
                    {sortedStations.map((station, index) => (
                      <span
                        key={station.id}
                        className={
                          index === currentIndex
                            ? 'dial-label dial-label-current'
                            : 'dial-label'
                        }
                        style={{ left: `${stationPositions[index]}px` }}
                      >
                        {station.frequency}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="dial-marker" aria-hidden="true" />
          </section>

          <section className="control-panel" aria-label="Playback controls">
            <div className="control-row">
              <ControlButton
                label="Previous station"
                className="control-button-small"
                onClick={goToPreviousStation}
              >
                <SkipIcon direction="previous" />
              </ControlButton>

              <ControlButton
                label={isPlaying ? 'Pause' : 'Play'}
                className="control-button-large"
                onClick={togglePlayback}
                disabled={!currentStation.isPlayable}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </ControlButton>

              <ControlButton
                label="Next station"
                className="control-button-small"
                onClick={goToNextStation}
              >
                <SkipIcon direction="next" />
              </ControlButton>
            </div>

            <div className="panel-divider" aria-hidden="true" />

            <div className="speaker-panel">
              <div className="speaker-volume-row">
                <VolumeIcon side="left" volumeValue={volumeValue} />
                <VolumeIcon side="right" volumeValue={volumeValue} />
              </div>
              <SpeakerGrid
                isDragging={isVolumeDragging}
                volumeValue={volumeValue}
                speakerGridRef={speakerGridRef}
                onPointerDown={handleVolumePointerDown}
                onPointerMove={handleVolumePointerMove}
                onPointerUp={handleVolumePointerEnd}
                onPointerCancel={handleVolumePointerEnd}
                onLostPointerCapture={handleVolumePointerEnd}
                onKeyDown={handleVolumeKeyDown}
              />
            </div>
          </section>
        </div>

        <audio ref={audioRef} preload="none" />
      </section>
    </main>
  )
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
    >
      <span className="theme-toggle-dot" />
    </button>
  )
}

function ControlButton({ children, className, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={`control-button ${className}`}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function SpeakerGrid({
  isDragging,
  volumeValue,
  speakerGridRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
}) {
  const columnProgress = volumeValue * SPEAKER_COLUMNS

  // Fill each column based on the continuous volume value so the boundary can be partially filled.
  function getDotStyle(tone, columnIndex) {
    if (tone === 'empty') {
      return undefined
    }

    const fillAmount = Math.min(1, Math.max(0, columnProgress - columnIndex))

    if (fillAmount <= 0) {
      return undefined
    }

    if (fillAmount >= 1) {
      return { background: 'var(--dot-active)' }
    }

    const fillPercent = Math.round(fillAmount * 100)

    return {
      background: `linear-gradient(90deg, var(--dot-active) ${fillPercent}%, var(--dot-inactive) ${fillPercent}%)`,
    }
  }

  return (
    <div
      ref={speakerGridRef}
      className={`speaker-grid-interactive${isDragging ? ' speaker-grid-interactive-dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(volumeValue * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onKeyDown={onKeyDown}
    >
      <div className="speaker-grid">
        {speakerPattern.map((row, rowIndex) =>
          row.map((tone, columnIndex) => (
            <span
              key={`${rowIndex}-${columnIndex}`}
              className={`speaker-dot${tone === 'empty' ? ' speaker-dot-empty' : ''}`}
              style={getDotStyle(tone, columnIndex)}
            />
          )),
        )}
      </div>
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" className="chevron-icon" aria-hidden="true">
      <path
        d="M8 5.5L15 12L8 18.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg
      width="50"
      height="50"
      viewBox="0 0 50 50"
      fill="none"
      className="transport-icon transport-icon-large"
      aria-hidden="true"
    >
      <path
        d="M39.0625 7.03125H31.25C30.6284 7.03125 30.0323 7.27818 29.5927 7.71772C29.1532 8.15726 28.9062 8.7534 28.9062 9.375V40.625C28.9062 41.2466 29.1532 41.8427 29.5927 42.2823C30.0323 42.7218 30.6284 42.9688 31.25 42.9688H39.0625C39.6841 42.9688 40.2802 42.7218 40.7198 42.2823C41.1593 41.8427 41.4062 41.2466 41.4062 40.625V9.375C41.4062 8.7534 41.1593 8.15726 40.7198 7.71772C40.2802 7.27818 39.6841 7.03125 39.0625 7.03125ZM39.8438 40.625C39.8438 40.8322 39.7614 41.0309 39.6149 41.1774C39.4684 41.3239 39.2697 41.4062 39.0625 41.4062H31.25C31.0428 41.4062 30.8441 41.3239 30.6976 41.1774C30.5511 41.0309 30.4688 40.8322 30.4688 40.625V9.375C30.4688 9.1678 30.5511 8.96909 30.6976 8.82257C30.8441 8.67606 31.0428 8.59375 31.25 8.59375H39.0625C39.2697 8.59375 39.4684 8.67606 39.6149 8.82257C39.7614 8.96909 39.8438 9.1678 39.8438 9.375V40.625ZM18.75 7.03125H10.9375C10.3159 7.03125 9.71976 7.27818 9.28022 7.71772C8.84068 8.15726 8.59375 8.7534 8.59375 9.375V40.625C8.59375 41.2466 8.84068 41.8427 9.28022 42.2823C9.71976 42.7218 10.3159 42.9688 10.9375 42.9688H18.75C19.3716 42.9688 19.9677 42.7218 20.4073 42.2823C20.8468 41.8427 21.0937 41.2466 21.0938 40.625V9.375C21.0937 8.7534 20.8468 8.15726 20.4073 7.71772C19.9677 7.27818 19.3716 7.03125 18.75 7.03125ZM19.5312 40.625C19.5312 40.8322 19.4489 41.0309 19.3024 41.1774C19.1559 41.3239 18.9572 41.4062 18.75 41.4062H10.9375C10.7303 41.4062 10.5316 41.3239 10.3851 41.1774C10.2386 41.0309 10.1562 40.8322 10.1562 40.625V9.375C10.1562 9.1678 10.2386 8.96909 10.3851 8.82257C10.5316 8.67606 10.7303 8.59375 10.9375 8.59375H18.75C18.9572 8.59375 19.1559 8.67606 19.3024 8.82257C19.4489 8.96909 19.5312 9.1678 19.5312 9.375V40.625Z"
        fill="currentColor"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg
      width="50"
      height="50"
      viewBox="0 0 50 50"
      fill="none"
      className="transport-icon transport-icon-large"
      aria-hidden="true"
    >
      <path
        d="M44.9844 23.0272L16.8438 5.81822C16.4882 5.59766 16.0798 5.47707 15.6615 5.46917C15.2432 5.46126 14.8305 5.56633 14.4668 5.77329C14.1059 5.97167 13.8052 6.26385 13.5965 6.61898C13.3878 6.9741 13.2789 7.37898 13.2813 7.79087V42.2088C13.2789 42.6207 13.3878 43.0256 13.5965 43.3807C13.8052 43.7359 14.1059 44.028 14.4668 44.2264C14.8305 44.4334 15.2432 44.5385 15.6615 44.5305C16.0798 44.5226 16.4882 44.4021 16.8438 44.1815L44.9844 26.9725C45.3231 26.7666 45.6031 26.4769 45.7974 26.1314C45.9917 25.7859 46.0937 25.3962 46.0937 24.9999C46.0937 24.6035 45.9917 24.2138 45.7974 23.8683C45.6031 23.5228 45.3231 23.2331 44.9844 23.0272ZM44.168 25.6385L16.0274 42.8495C15.9082 42.9227 15.7716 42.9626 15.6318 42.965C15.492 42.9674 15.3541 42.9322 15.2325 42.8631C15.1139 42.8001 15.0148 42.7058 14.9459 42.5905C14.8771 42.4751 14.8411 42.3432 14.8418 42.2088V7.79087C14.8411 7.65656 14.8771 7.52459 14.9459 7.40926C15.0148 7.29393 15.1139 7.19964 15.2325 7.13658C15.3541 7.0675 15.492 7.03233 15.6318 7.03473C15.7716 7.03714 15.9082 7.07703 16.0274 7.15025L44.168 24.3612C44.2789 24.4269 44.3709 24.5203 44.4347 24.6323C44.4985 24.7443 44.5321 24.8709 44.5321 24.9999C44.5321 25.1288 44.4985 25.2555 44.4347 25.3674C44.3709 25.4794 44.2789 25.5729 44.168 25.6385Z"
        fill="currentColor"
      />
    </svg>
  )
}

function PrevIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      className="transport-icon transport-icon-small"
      aria-hidden="true"
    >
      <path
        d="M6.99997 4.5C7.13258 4.5 7.25975 4.55268 7.35352 4.64645C7.44729 4.74021 7.49997 4.86739 7.49997 5V14.555L23.2112 4.73C23.4383 4.58802 23.6993 4.50943 23.967 4.50239C24.2347 4.49536 24.4995 4.56014 24.7337 4.69C24.9669 4.81606 25.1614 5.00317 25.2963 5.23129C25.4313 5.45941 25.5017 5.71995 25.5 5.985V26.015C25.5017 26.2801 25.4313 26.5406 25.2963 26.7687C25.1614 26.9968 24.9669 27.1839 24.7337 27.31C24.4995 27.4399 24.2347 27.5046 23.967 27.4976C23.6993 27.4906 23.4383 27.412 23.2112 27.27L7.49997 17.445V27C7.49997 27.1326 7.44729 27.2598 7.35352 27.3536C7.25975 27.4473 7.13258 27.5 6.99997 27.5C6.86736 27.5 6.74018 27.4473 6.64641 27.3536C6.55265 27.2598 6.49997 27.1326 6.49997 27V5C6.49997 4.86739 6.55265 4.74021 6.64641 4.64645C6.74018 4.55268 6.86736 4.5 6.99997 4.5ZM7.72747 16.4075L23.7425 26.4225C23.8181 26.4699 23.9051 26.4962 23.9943 26.4986C24.0836 26.501 24.1719 26.4795 24.25 26.4363C24.326 26.3954 24.3894 26.3346 24.4335 26.2603C24.4775 26.1861 24.5005 26.1013 24.5 26.015V5.985C24.5005 5.8987 24.4775 5.81388 24.4335 5.73966C24.3894 5.66544 24.326 5.60463 24.25 5.56375C24.1736 5.521 24.0874 5.49901 24 5.5C23.9065 5.50068 23.8152 5.52753 23.7362 5.5775L7.72122 15.5925C7.65169 15.6354 7.59428 15.6953 7.55447 15.7667C7.51466 15.838 7.49376 15.9183 7.49376 16C7.49376 16.0817 7.51466 16.162 7.55447 16.2333C7.59428 16.3047 7.65169 16.3646 7.72122 16.4075H7.72747Z"
        fill="currentColor"
        fillOpacity="0.6"
      />
    </svg>
  )
}

function NextIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      className="transport-icon transport-icon-small"
      aria-hidden="true"
    >
      <path
        d="M25 4.5C24.8674 4.5 24.7402 4.55268 24.6465 4.64645C24.5527 4.74021 24.5 4.86739 24.5 5V14.555L8.78878 4.73C8.56169 4.58802 8.30072 4.50943 8.03299 4.50239C7.76525 4.49536 7.50052 4.56014 7.26628 4.69C7.03312 4.81606 6.83863 5.00317 6.70366 5.23129C6.56868 5.45941 6.49829 5.71995 6.50003 5.985V26.015C6.49829 26.2801 6.56868 26.5406 6.70366 26.7687C6.83863 26.9968 7.03312 27.1839 7.26628 27.31C7.50052 27.4399 7.76525 27.5046 8.03299 27.4976C8.30072 27.4906 8.56169 27.412 8.78878 27.27L24.5 17.445V27C24.5 27.1326 24.5527 27.2598 24.6465 27.3536C24.7402 27.4473 24.8674 27.5 25 27.5C25.1326 27.5 25.2598 27.4473 25.3536 27.3536C25.4474 27.2598 25.5 27.1326 25.5 27V5C25.5 4.86739 25.4474 4.74021 25.3536 4.64645C25.2598 4.55268 25.1326 4.5 25 4.5ZM24.2725 16.4075L8.25753 26.4225C8.18187 26.4699 8.0949 26.4962 8.00566 26.4986C7.91641 26.501 7.82815 26.4795 7.75003 26.4363C7.67402 26.3954 7.61059 26.3346 7.56654 26.2603C7.5225 26.1861 7.4995 26.1013 7.50003 26.015V5.985C7.4995 5.8987 7.5225 5.81388 7.56654 5.73966C7.61059 5.66544 7.67402 5.60463 7.75003 5.56375C7.82635 5.521 7.91256 5.49901 8.00003 5.5C8.09346 5.50068 8.18483 5.52753 8.26378 5.5775L24.2788 15.5925C24.3483 15.6354 24.4057 15.6953 24.4455 15.7667C24.4853 15.838 24.5062 15.9183 24.5062 16C24.5062 16.0817 24.4853 16.162 24.4455 16.2333C24.4057 16.3047 24.3483 16.3646 24.2788 16.4075H24.2725Z"
        fill="currentColor"
        fillOpacity="0.6"
      />
    </svg>
  )
}

function SkipIcon({ direction }) {
  return direction === 'previous' ? <PrevIcon /> : <NextIcon />
}

function VolumeIcon({ side, volumeValue }) {
  const opacity =
    side === 'left'
      ? Math.max(0.42, 1 - volumeValue * 0.55)
      : Math.max(0.42, 0.45 + volumeValue * 0.55)

  return (
    <img
      src={side === 'left' ? volumeLowIcon : volumeHighIcon}
      className={`volume-icon volume-icon-${side}`}
      style={{ opacity }}
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  )
}

export default App
