import type { FC, ReactNode } from 'react';
import './EmptyState.css';

// Empty-state pictogram (document + magnifier) taken verbatim from the FSP
// design (fsp_search_v1.html) so every "no results" pane matches the
// mock-up. Rendered at 80×80 in the interactive blue via the parent's color.
const NoResultsIcon = () => (
  <svg
    width="80"
    height="80"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect width="32" height="32" fill="white" fillOpacity="0.01" />
    <path
      d="M11.0006 29.36H2.00063C1.80163 29.36 1.64062 29.199 1.64062 29L1.64063 1.00001C1.64063 0.801015 1.80163 0.640015 2.00063 0.640015L18.0006 0.640015C18.0966 0.640015 18.1886 0.678015 18.2556 0.745015L24.2556 6.74501C24.3226 6.81301 24.3606 6.90401 24.3606 7.00001V12H23.6406V7.36001H18.0006C17.8016 7.36001 17.6406 7.19901 17.6406 7.00001V1.36001H2.36062V28.64H11.0006V29.36ZM18.3606 6.64001H23.1316L18.3606 1.86901V6.64001ZM11.0006 19.36H6.00063V18.64H11.0006V19.36ZM16.0006 13.36H6.00063V12.64H16.0006V13.36Z"
      fill="currentColor"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M29 23C29 18.5817 25.4183 15 21 15C16.5817 15 13 18.5817 13 23C13 27.4183 16.5817 31 21 31C23.1804 31 25.157 30.1277 26.6 28.7131L30.5 32L31 31.5L27.1244 28.1472C28.2949 26.756 29 24.9604 29 23ZM21 15.7002C16.9683 15.7002 13.7002 18.9683 13.7002 23C13.7002 27.0317 16.9683 30.2998 21 30.2998C25.0317 30.2998 28.2998 27.0317 28.2998 23C28.2998 18.9683 25.0317 15.7002 21 15.7002Z"
      fill="currentColor"
    />
  </svg>
);

interface EmptyStateProps {
  /** Bold headline, e.g. "No results found". */
  title: string;
  /** Supporting copy; accepts nodes so callers can include line breaks. */
  body: ReactNode;
}

/**
 * Centered "no results" pane shared across the search/list pages. Render it
 * inside a results container when a search/load has run and come back empty.
 */
export const EmptyState: FC<EmptyStateProps> = ({ title, body }) => (
  <div className="bc-empty-state">
    <div className="bc-empty-state__pictogram" aria-hidden="true">
      <NoResultsIcon />
    </div>
    <p className="bc-empty-state__title">{title}</p>
    <p className="bc-empty-state__body">{body}</p>
  </div>
);

export default EmptyState;
