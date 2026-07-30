// "No results found" pictogram (document + magnifier), matching the design's
// pictogram_no_results_found.svg but drawn with thin STROKES instead of filled
// outlines. The source SVG's filled outlines rendered ~1.08px lines — 2× the
// weight of the Carbon pictograms (@carbon/pictograms-react) used by the other
// empty states. Stroking at a Carbon-matched width keeps this icon visually
// consistent with those. `currentColor` inherits the empty-state wrapper's
// interactive blue; `non-scaling-stroke` keeps the hairline crisp at any size.
export const NoResultsFoundIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 48 48"
    fill="none"
    stroke="currentColor"
    strokeWidth={0.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* Document with a folded top-right corner */}
    <path d="M3 1.5H27L36 10.5V43.5H3Z" vectorEffect="non-scaling-stroke" />
    <path d="M27 1.5V10.5H36" vectorEffect="non-scaling-stroke" />
    {/* Text lines */}
    <path d="M9 19.5H24" vectorEffect="non-scaling-stroke" />
    <path d="M9 28.5H16.5" vectorEffect="non-scaling-stroke" />
    {/* Magnifier over the document's lower-right */}
    <circle cx="31.5" cy="34.5" r="11.5" vectorEffect="non-scaling-stroke" />
    <path d="M40 43L46 48" vectorEffect="non-scaling-stroke" />
  </svg>
);
