import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import './App.css'
import nextIcon from './assets/icons/next.svg'
import pauseIcon from './assets/icons/pause.svg'
import playIcon from './assets/icons/play.svg'
import prevIcon from './assets/icons/prev.svg'
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
const APP_BASE_WIDTH = 375
const APP_BASE_HEIGHT = 812

const speakerPattern = [
  ['dark', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light'],
  ['dark', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light'],
  ['dark', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light'],
  ['dark', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light'],
  ['empty', 'dark', 'half', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'light', 'empty'],
]
const SPEAKER_COLUMNS = speakerPattern[0].length

function stationHasSourceConfig(station) {
  if (station.streamType === 'direct') {
    return Boolean(station.streamUrl)
  }

  return Boolean(station.apiUrl)
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

function getCanvasScale() {
  if (typeof window === 'undefined') {
    return 1
  }

  return Math.min(window.innerWidth / APP_BASE_WIDTH, window.innerHeight / APP_BASE_HEIGHT)
}

async function resolveStreamUrl(station) {
  if (station.streamType === 'direct') {
    const directUrl = station.streamUrl?.trim() ?? ''

    if (!directUrl) {
      throw new Error('Stream URL is not available.')
    }

    if (!isValidStreamUrl(directUrl)) {
      throw new Error('The direct stream URL is missing or invalid.')
    }

    console.log('[STREAM] final streamUrl:', directUrl)
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

    console.log('[STREAM] final streamUrl:', streamUrl)
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

    console.log('[STREAM] final streamUrl:', text)
    return text
  }

  throw new Error('This station has an unsupported stream type.')
}

function App() {
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
  const [canvasScale, setCanvasScale] = useState(getCanvasScale)
  const audioRef = useRef(null)
  const hlsRef = useRef(null)
  const playRequestRef = useRef(0)
  const tunerViewportRef = useRef(null)
  const speakerGridRef = useRef(null)
  const tunerSnapTimeoutRef = useRef(null)
  const tunerCommitTimeoutRef = useRef(null)
  const volumeAnimationFrameRef = useRef(0)
  const activeVolumePointerIdRef = useRef(null)
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
    function handleCanvasResize() {
      setCanvasScale(getCanvasScale())
    }

    handleCanvasResize()
    window.addEventListener('resize', handleCanvasResize)

    return () => {
      window.removeEventListener('resize', handleCanvasResize)
    }
  }, [])

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
        currentSrc: audio.currentSrc,
        errorCode: audio.error?.code,
        errorMessage: audio.error?.message,
        networkState: audio.networkState,
        readyState: audio.readyState,
      })
      setIsLoading(false)
      setIsPlaying(false)
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
    activeVolumePointerIdRef.current = event.pointerId
    setIsVolumeDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
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
    activeVolumePointerIdRef.current = null
    setIsVolumeDragging(false)
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

    if (!stationHasSourceConfig(station)) {
      setIsLoading(false)
      setIsPlaying(false)
      return
    }

    setIsLoading(true)
    setIsPlaying(false)

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
      } catch {
        if (playRequestRef.current !== playRequestId) {
          return
        }

        clearAudioSource()
        setIsLoading(false)
        setIsPlaying(false)
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
    <main className="app-stage">
      <div
        className="app-canvas"
        style={{ transform: `translateX(-50%) scale(${canvasScale})` }}
      >
        <section className="radio-app" aria-label="FM radio app">
          <header className="app-header">
            <div className="app-title">
              <span>FM RADIO</span>
              <ChevronIcon />
            </div>
          </header>

          <section className="station-display" aria-label="Current station">
            <div className="frequency-readout">
              <span className="frequency-value">{visualFrequency.toFixed(1)}</span>
              <span className="frequency-unit">MHz</span>
            </div>
            <p className="station-name">{currentStation.name}</p>
          </section>

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

          <audio ref={audioRef} preload="none" />
        </section>
      </div>
    </main>
  )
}

function ControlButton({ children, className, label, onClick }) {
  return (
    <button
      type="button"
      className={`control-button ${className}`}
      aria-label={label}
      onClick={onClick}
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
      return { background: '#000000' }
    }

    const fillPercent = Math.round(fillAmount * 100)

    return {
      background: `linear-gradient(90deg, #000000 ${fillPercent}%, #d3d3d3 ${fillPercent}%)`,
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

function TransportIcon({ src, className }) {
  return (
    <img
      src={src}
      className={`transport-icon ${className ?? ''}`}
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  )
}

function SkipIcon({ direction }) {
  return (
    <TransportIcon
      src={direction === 'previous' ? prevIcon : nextIcon}
      className="transport-icon-small"
    />
  )
}

function PauseIcon() {
  return <TransportIcon src={pauseIcon} className="transport-icon-large" />
}

function PlayIcon() {
  return <TransportIcon src={playIcon} className="transport-icon-large" />
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
