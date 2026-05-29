import { Accordion, AccordionItem, Column, Grid, Loading } from '@carbon/react';
import { useEffect, useState, type FC } from 'react';

import { useNotification } from '@/context/notification/useNotification';
import { getOrgUnits, type CodeOption } from '@/services/fspSearch';

import ReportConfigForm from './ReportConfigForm';
import { REPORT_DEFINITIONS, type ReportDefinition } from './reportDefinitions';

import './reports.scss';

interface ReportRowProps {
  definition: ReportDefinition;
}

// Two-cell row that drives both the header band and the accordion
// title. Grid alignment is set in reports.scss (.reports-row).
const ReportAccordionTitle: FC<ReportRowProps> = ({ definition }) => (
  <div className="reports-row">
    <div className="reports-row__cell reports-row__cell--name">{definition.title}</div>
    <div className="reports-row__cell reports-row__cell--description">
      {definition.summary}
    </div>
  </div>
);

const JcrsReportsPage: FC = () => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [orgUnits, setOrgUnits] = useState<CodeOption[]>([]);
  const [orgUnitsLoading, setOrgUnitsLoading] = useState(true);

  const { display } = useNotification();

  // Load the org-units code list once, share it across all open
  // accordion rows. Failures surface via the standard toast — we
  // still render the table so non-org-unit reports remain usable.
  useEffect(() => {
    let cancelled = false;
    getOrgUnits()
      .then((rows) => {
        if (!cancelled) setOrgUnits(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          display({
            kind: 'warning',
            title: 'Org units unavailable',
            subtitle:
              e instanceof Error ? e.message : 'Failed to load the org-unit list.',
            timeout: 7000,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setOrgUnitsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [display]);

  return (
    <Grid fullWidth className="default-grid fsp-reports-grid">
      <Column sm={4} md={8} lg={16}>
        <div className="fsp-reports__header">
          <h1>Reports</h1>
        </div>
      </Column>

      <Column sm={4} md={8} lg={16}>
        {orgUnitsLoading && orgUnits.length === 0 ? (
          <div className="fsp-reports__loading" role="status" aria-live="polite">
            <Loading description="Loading…" withOverlay={false} />
          </div>
        ) : (
          <div className="reports-accordion-table">
            <div className="reports-row reports-row--header" role="row">
              <div className="reports-row__cell reports-row__cell--name">Report</div>
              <div className="reports-row__cell reports-row__cell--description">
                Description
              </div>
            </div>
            <Accordion className="reports-accordion" align="start">
              {REPORT_DEFINITIONS.map((definition) => {
                const isOpen = openId === definition.id;
                return (
                  <AccordionItem
                    key={definition.id}
                    open={isOpen}
                    onHeadingClick={({ isOpen: nextOpen }) =>
                      setOpenId(nextOpen ? definition.id : null)
                    }
                    title={<ReportAccordionTitle definition={definition} />}
                  >
                    <ReportConfigForm
                      definition={definition}
                      orgUnits={orgUnits}
                      orgUnitsLoading={orgUnitsLoading}
                    />
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        )}
      </Column>
    </Grid>
  );
};

export default JcrsReportsPage;
