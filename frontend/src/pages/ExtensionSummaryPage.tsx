import {
  Column,
  DataTable,
  Grid,
  Loading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import {ArrowLeft} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';

import {useNotification} from '@/context/notification/useNotification';
import {type FspExtensionSummary, getFspExtensions,} from '@/services/fspSearch';

import './FspInformation/fsp-info.scss';

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

// Carbon Tag colour by extension status code. Codes mirror the FSP
// status code list (APP/INE/SUB/REJ etc.). Unknown values fall back
// to gray via the lookup default.
const STATUS_TAG: Record<string, 'green' | 'blue' | 'gray' | 'red' | 'warm-gray'> = {
  APP: 'green',
  INE: 'green',
  SUB: 'blue',
  DFT: 'gray',
  REJ: 'red',
  RET: 'warm-gray',
};

const HEADERS = [
  { key: 'extensionNumber', header: 'Ext #' },
  { key: 'submissionDate', header: 'Request Date' },
  { key: 'status', header: 'Status' },
  { key: 'decisionDate', header: 'Decision Date' },
  { key: 'term', header: 'Term' },
  { key: 'planEndDate', header: 'Expiry Date' },
  { key: 'planStartDate', header: 'Effective Date' },
  { key: 'fspAmendmentNumber', header: 'Amnd # in Effect' },
];

const ExtensionSummaryPage: FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { display } = useNotification();
  const fspId = searchParams.get('fspId') ?? '';

  const [summary, setSummary] = useState<FspExtensionSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    getFspExtensions(fspId)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((e) => {
        if (cancelled) return;
        display({
          kind: 'error',
          title: 'Unable to load extensions',
          subtitle: e instanceof Error ? e.message : 'Unknown error',
          timeout: 7000,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId, display]);

  const backToFsp = () => {
    if (fspId) {
      navigate(`/fsp/information?fspId=${encodeURIComponent(fspId)}`);
    } else {
      navigate('/search');
    }
  };

  const tombstone: { label: string; value: string }[] = summary
    ? [
        { label: 'FSP Name', value: dash(summary.fspPlanName) },
        { label: 'Effective Date', value: dash(summary.originalEffectiveDate) },
        {
          label: 'Original Expiry Date',
          value: dash(summary.originalExpiryDate),
        },
        {
          label: 'Current Term',
          value: `${dash(summary.currentPlanTermYears)} yr ${dash(
            summary.currentPlanTermMonths,
          )} mo`,
        },
        {
          label: 'Current Expiry Date',
          value: dash(summary.currentExpiryDate),
        },
      ]
    : [];

  const tableRows =
    summary?.extensions.map((e, i) => ({
      id: e.extensionId ?? `row-${i}`,
      extensionNumber: dash(e.extensionNumber),
      submissionDate: dash(e.submissionDate),
      status: dash(e.statusCode),
      decisionDate: dash(e.decisionDate),
      term: `${dash(e.planTermYears)} yr ${dash(e.planTermMonths)} mo`,
      planEndDate: dash(e.planEndDate),
      planStartDate: dash(e.planStartDate),
      fspAmendmentNumber: dash(e.fspAmendmentNumber),
    })) ?? [];

  return (
    <Grid fullWidth className="default-grid fsp-info-grid">
      <Column sm={4} md={8} lg={16}>
        <button type="button" className="fsp-info__back" onClick={backToFsp}>
          <ArrowLeft size={16} /> Back to FSP {fspId}
        </button>
      </Column>

      <Column sm={4} md={8} lg={16}>
        <header className="fsp-info__header">
          <div className="fsp-info__header-title">
            <h1>Extension Summary — FSP {fspId || '—'}</h1>
          </div>
        </header>
      </Column>

      <Column sm={4} md={8} lg={16}>
        {!fspId ? (
          <p className="fsp-info__placeholder">No FSP selected.</p>
        ) : loading && !summary ? (
          <div className="fsp-info__loading" role="status" aria-live="polite">
            <Loading description="Loading extensions…" withOverlay={false} />
          </div>
        ) : !summary ? (
          <p className="fsp-info__placeholder">
            FSP not found or you do not have access to it.
          </p>
        ) : (
          <div className="fsp-info__tiles-grid">
            <section className="fsp-info__tile fsp-info__tile--full">
              <header className="fsp-info__tile-header">
                <h2 className="fsp-info__section-title">FSP Tombstone</h2>
              </header>
              <dl className="fsp-info__field-list">
                {tombstone.map((f) => (
                  <div key={f.label} className="fsp-info__field">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="fsp-info__tile fsp-info__tile--full">
              <header className="fsp-info__tile-header">
                <h2 className="fsp-info__section-title">
                  Extensions ({summary.extensions.length})
                </h2>
              </header>
              {summary.extensions.length === 0 ? (
                <p>No extension requests recorded for this FSP.</p>
              ) : (
                <div className="bordered-table">
                  <DataTable rows={tableRows} headers={HEADERS}>
                    {({ rows: r, headers, getTableProps, getHeaderProps, getRowProps }) => (
                      <TableContainer>
                        <Table {...getTableProps()} size="md" useZebraStyles>
                          <TableHead>
                            <TableRow>
                              {headers.map((h) => (
                                <TableHeader
                                  {...getHeaderProps({ header: h })}
                                  key={h.key}
                                >
                                  {h.header}
                                </TableHeader>
                              ))}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {r.map((row) => (
                              <TableRow {...getRowProps({ row })} key={row.id}>
                                {row.cells.map((cell) => {
                                  if (cell.info.header === 'status' && cell.value) {
                                    const code = cell.value as string;
                                    return (
                                      <TableCell key={cell.id}>
                                        <Tag type={STATUS_TAG[code] ?? 'gray'} size="sm">
                                          {code}
                                        </Tag>
                                      </TableCell>
                                    );
                                  }
                                  return (
                                    <TableCell key={cell.id}>
                                      {cell.value as string}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </DataTable>
                </div>
              )}
            </section>
          </div>
        )}
      </Column>
    </Grid>
  );
};

export default ExtensionSummaryPage;
