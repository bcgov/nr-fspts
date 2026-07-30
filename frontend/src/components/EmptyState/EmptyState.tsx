import type { FC, ReactNode } from 'react';

import { NoResultsFoundIcon } from './NoResultsFoundIcon';
import './EmptyState.css';

interface EmptyStateProps {
  /** Bold headline, e.g. "No results found". */
  title: string;
  /** Supporting copy; accepts nodes so callers can include line breaks. */
  body: ReactNode;
  /**
   * Optional pictogram override. Defaults to the shared "no results"
   * document + magnifier. Pass e.g. a Carbon `<DocumentAdd size={80} />`
   * for an empty collection that invites the user to add something.
   */
  icon?: ReactNode;
  /**
   * Optional call-to-action rendered beneath the body — typically a
   * primary Button. Callers gate this on permissions themselves.
   */
  action?: ReactNode;
}

/**
 * Centered "no results" pane shared across the search/list pages. Render it
 * inside a results container when a search/load has run and come back empty.
 */
export const EmptyState: FC<EmptyStateProps> = ({ title, body, icon, action }) => (
  <div className="bc-empty-state">
    <div className="bc-empty-state__pictogram" aria-hidden="true">
      {icon ?? <NoResultsFoundIcon />}
    </div>
    <p className="bc-empty-state__title">{title}</p>
    <p className="bc-empty-state__body">{body}</p>
    {action && <div className="bc-empty-state__action">{action}</div>}
  </div>
);

export default EmptyState;
