import {Column, Grid, Loading, Select, SelectItem, Tab, TabList, TabPanel, TabPanels, Tabs, Tag,} from '@carbon/react';
import {ArrowLeft} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';

import {useNotification} from '@/context/notification/useNotification';
import {type CodeOption, type FspInformation, getFspAmendmentNumbers, getFspById,} from '@/services/fspSearch';

import AttachmentsTab from './tabs/AttachmentsTab';
import InformationTab from './tabs/InformationTab';
import IdentifiedAreasTab from './tabs/IdentifiedAreasTab';
import MapTab from './tabs/MapTab';
import StockingStandardsTab from './tabs/StockingStandardsTab';
import WorkflowTab from './tabs/WorkflowTab';
import WorkflowDataTab from './tabs/WorkflowDataTab';

import './fsp-info.scss';

// Carbon Tag color by status description — same palette the search
// results table uses so the badge reads consistently when the user
// crosses over.
const STATUS_TAG_TYPE_BY_DESC: Record<
  string,
  'green' | 'blue' | 'gray' | 'red' | 'warm-gray'
> = {
  Approved: 'green',
  Submitted: 'blue',
  Draft: 'gray',
  Rejected: 'red',
  Expired: 'warm-gray',
};

const FspInformationPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { display } = useNotification();

  const fspId = searchParams.get('fspId') ?? '';
  const amendmentNumber = searchParams.get('amendmentNumber') ?? '';

  const [fsp, setFsp] = useState<FspInformation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Amendments-dropdown options for this FSP. Loaded once per fspId
  // change; switching amendments only re-fetches the FSP record.
  const [amendments, setAmendments] = useState<CodeOption[]>([]);

  useEffect(() => {
    if (!fspId) {
      setError('No FSP selected. Pick one from the Search page.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspById(fspId, amendmentNumber || undefined)
      .then((data) => {
        if (!cancelled) setFsp(data);
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : 'Failed to load FSP.';
        setError(message);
        display({
          kind: 'error',
          title: 'Unable to load FSP',
          subtitle: message,
          timeout: 7000,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, amendmentNumber, display]);

  // Amendment-numbers fetch is independent of the FSP fetch — it only
  // depends on fspId. Refresh only when the user switches FSPs.
  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    getFspAmendmentNumbers(fspId)
      .then((rows) => {
        if (!cancelled) setAmendments(rows);
      })
      .catch(() => {
        // Non-fatal: just leaves the dropdown empty/uncontrolled.
        if (!cancelled) setAmendments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId]);

  const handleAmendmentChange = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) {
      params.set('amendmentNumber', next);
    } else {
      params.delete('amendmentNumber');
    }
    setSearchParams(params);
  };

  // The active amendment for the dropdown's value. Falls back to the
  // proc-resolved amendment from the FSP record when the URL didn't
  // pin one (matches what the user sees in the meta block).
  const selectedAmendment =
    amendmentNumber || fsp?.fspAmendmentNumber || '';

  // Width fallback for browsers without `field-sizing: content`. Use the
  // displayed text length of the selected option (e.g. "Original" = 8,
  // "1" = 1) + a chevron allowance, expressed in `ch` units. Six ch
  // gives the chevron enough room not to clip the option text.
  const selectedLabel =
    amendments.find((a) => a.code === selectedAmendment)?.description ??
    selectedAmendment ??
    '';
  const amendmentSelectWidth = `${Math.max(2, selectedLabel.length) + 6}ch`;

  const statusDesc = fsp?.fspStatusDesc?.trim() ?? '';
  const planName = fsp?.fspPlanName?.trim() || '—';
  // The proc returns 200 + all-null fields when the requested FSP id
  // can't be resolved in forest_stewardship_plan (warning-only error
  // path, not a fatal HTTP error). Treat that as "not found" on the
  // client side so the user sees an explicit empty state instead of a
  // silently-blank header + tabs.
  const fspMissing = !loading && !!fsp && !fsp.fspId && !fsp.fspPlanName;

  return (
    <Grid fullWidth className="default-grid fsp-info-grid">
      <Column sm={4} md={8} lg={16}>
        <button
          type="button"
          className="fsp-info__back"
          onClick={() => navigate('/search')}
        >
          <ArrowLeft size={16} /> Back to search
        </button>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <header className="fsp-info__header">
          <div className="fsp-info__header-title">
            <h1>
              FSP {fsp?.fspId ?? fspId}
              {fspMissing ? '' : ` — ${planName}`}
            </h1>
            {statusDesc && (
              <Tag type={STATUS_TAG_TYPE_BY_DESC[statusDesc] ?? 'gray'} size="md">
                {statusDesc}
              </Tag>
            )}
          </div>
          {!fspMissing && (
            <dl className="fsp-info__meta">
              <div className="fsp-info__meta-item fsp-info__meta-item--select">
                <strong>Amendment</strong>
                <Select
                  id="fsp-amendment-picker"
                  labelText=""
                  hideLabel
                  size="sm"
                  style={{ width: amendmentSelectWidth }}
                  value={selectedAmendment}
                  onChange={(e) => handleAmendmentChange(e.target.value)}
                  disabled={amendments.length === 0}
                >
                  {amendments.length === 0 && (
                    <SelectItem
                      value={selectedAmendment}
                      text={selectedAmendment || '—'}
                    />
                  )}
                  {amendments.map((a) => (
                    <SelectItem key={a.code} value={a.code} text={a.description} />
                  ))}
                </Select>
              </div>
              <div className="fsp-info__meta-item">
                <strong>Effective</strong>
                <span>{fsp?.fspPlanStartDate ?? '—'}</span>
              </div>
              <div className="fsp-info__meta-item">
                <strong>Expiry</strong>
                <span>{fsp?.fspExpiryDate ?? '—'}</span>
              </div>
            </dl>
          )}
        </header>
      </Column>

      <Column sm={4} md={8} lg={16}>
        {loading && !fsp ? (
          <div className="fsp-info__loading" role="status" aria-live="polite">
            <Loading description="Loading FSP…" withOverlay={false} />
          </div>
        ) : error && !fsp ? (
          <p className="fsp-info__error" role="alert">
            {error}
          </p>
        ) : fspMissing ? (
          <div className="fsp-info__placeholder" role="status">
            <p>
              FSP <strong>{fspId}</strong> was not found.
            </p>
            <p>
              It may not exist in this environment, or you may not have access to
              it. Try a fresh search to see the FSPs available to your account.
            </p>
          </div>
        ) : (
          <div
            className={`fsp-info__content${
              loading ? ' fsp-info__content--loading' : ''
            }`}
          >
            {loading && (
              <div
                className="fsp-info__content-overlay"
                role="status"
                aria-live="polite"
              >
                <Loading description="Loading FSP…" withOverlay={false} />
              </div>
            )}
          <Tabs>
            <TabList aria-label="FSP sections" contained>
              <Tab>Information</Tab>
              <Tab>Attachments</Tab>
              <Tab>Stocking Standards</Tab>
              <Tab>FDU / Map</Tab>
              <Tab>Identified Areas</Tab>
              <Tab>History</Tab>
              <Tab>Workflow</Tab>
            </TabList>
            <TabPanels>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <InformationTab fsp={fsp} onSaved={setFsp} />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <AttachmentsTab fspId={fspId} />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <StockingStandardsTab
                    fspId={fspId}
                    amendmentNumber={
                      fsp?.fspAmendmentNumber || amendmentNumber || ''
                    }
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <MapTab
                    fspId={fspId}
                    amendmentNumber={
                      fsp?.fspAmendmentNumber || amendmentNumber || '0'
                    }
                    variant="fdu"
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <IdentifiedAreasTab
                    fspId={fspId}
                    amendmentNumber={
                      fsp?.fspAmendmentNumber || amendmentNumber || '0'
                    }
                  />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <WorkflowTab fspId={fspId} />
                </div>
              </TabPanel>
              <TabPanel>
                <div className="fsp-info__tab-panel">
                  <WorkflowDataTab fspId={fspId} />
                </div>
              </TabPanel>
            </TabPanels>
          </Tabs>
          </div>
        )}
      </Column>
    </Grid>
  );
};

export default FspInformationPage;
