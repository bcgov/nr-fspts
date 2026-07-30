// Thin-stroke "document + plus" glyph for attachment empty states. Carbon's
// filled DocumentAdd reads too heavy at pictogram size; a stroked SVG with
// non-scaling-stroke keeps the lines a crisp ~1.5px at any rendered size.
// Shared by the FSP AttachmentsTab and the stocking-standard attachments tab
// so both empty states show the same icon.
export const EmptyDocumentAddIcon = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path
      d="M18 4H8a1 1 0 0 0-1 1v22a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V11z"
      vectorEffect="non-scaling-stroke"
    />
    <path d="M18 4v7h7" vectorEffect="non-scaling-stroke" />
    <path d="M16 15v8M12 19h8" vectorEffect="non-scaling-stroke" />
  </svg>
);
