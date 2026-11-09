import { useEffect, useState } from 'react';

/**
 * A QR code for some text, drawn as one SVG path. The generator is loaded only when a code is first shown, so it costs
 * nothing until then. The quiet border QR readers need is built in, and the colours come from the page, so the code is
 * dark on white wherever it is put.
 */
export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const [matrix, setMatrix] = useState<boolean[][] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('uqr')
      .then(({ encode }) => {
        if (!cancelled) setMatrix(encode(text, { ecc: 'M', border: 0 }).data);
      })
      .catch(() => {
        // No code drawn. The link itself is still shown next to it.
        if (!cancelled) setMatrix(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);
  if (!matrix) return <span className={`qr qr-wait ${className ?? ''}`} role="img" aria-label={label} />;
  const n = matrix.length;
  const border = 3;
  const d = matrix.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x + border} ${y + border}h1v1h-1z`] : []))).join('');
  return (
    <svg className={`qr ${className ?? ''}`} viewBox={`0 0 ${n + border * 2} ${n + border * 2}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n + border * 2} height={n + border * 2} fill="#fff" />
      <path d={d} fill="#111" />
    </svg>
  );
}
