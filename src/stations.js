export const stations = [
  // Add or edit Korean FM stations here.
  // `streamType` decides how the app finds the real audio stream.
  {
    id: 'kbs-classic-fm',
    name: 'KBS Classic FM',
    frequency: '93.1',
    streamType: 'kbs-api',
    apiUrl: '/api/kbs?channelCode=24',
  },
  {
    id: 'mbc-fm4u',
    name: 'MBC FM4U',
    frequency: '91.9',
    streamType: 'plain-text-api',
    apiUrl: '/api/mbc?agent=webapp&channel=mfm',
  },
  {
    id: 'sbs-power-fm',
    name: 'SBS Power FM',
    frequency: '107.7',
    streamType: 'plain-text-api',
    apiUrl: 'https://apis.sbs.co.kr/play-api/1.0/livestream/powerpc/powerfm?protocol=hls&ssl=Y',
  },
  {
    id: 'ebs-fm',
    name: 'EBS FM',
    frequency: '104.5',
    streamType: 'direct',
    streamUrl: 'https://ebsonair.ebs.co.kr/fmradiofamilypc/familypc1m/playlist.m3u8',
  },
]
