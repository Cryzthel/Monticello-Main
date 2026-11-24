import { useMemo } from 'react'
import { encode } from 'uqr'

/**
 * A QR code for any string, drawn as React SVG — no raw HTML, no canvas. One
 * path for every dark module keeps the DOM to a single node however large the
 * code is. The quiet zone (4 modules) is part of the drawing, so it scans on
 * any background, and the SVG scales cleanly for print.
 *
 *   import QrCode from '@shared/components/QrCode'
 *   import { APK_DOWNLOAD_URL } from '@shared/lib/appDownload'
 *   <QrCode value={APK_DOWNLOAD_URL} label="Download the app" size={240} />
 */
export default function QrCode({ value, size = 168, label, color = '#0F172A', className = 'rounded-lg bg-white' }) {
  const path = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 4 })
    let d = ''
    data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z` }))
    return { d, n: data.length }
  }, [value])
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${path.n} ${path.n}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <path d={path.d} fill={color} />
    </svg>
  )
}
