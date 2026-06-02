import {
  Button,
  DataTable,
  Loading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@carbon/react';
import {Download} from '@carbon/icons-react';
import {type FC, useEffect, useState} from 'react';

import {useNotification} from '@/context/notification/useNotification';
import {downloadFspAttachment, type FspAttachmentRow, getFspAttachments,} from '@/services/fspSearch';

interface Props {
  fspId: string;
}

const dash = (value: string | null | undefined): string =>
  value && value.trim() !== '' ? value : '—';

const HEADERS = [
  { key: 'category', header: 'Category' },
  { key: 'attachmentName', header: 'File' },
  { key: 'attachmentDescription', header: 'Description' },
  { key: 'attachmentSize', header: 'Size' },
  { key: 'fspAmendmentNumber', header: 'Amendment' },
  { key: 'consolidatedInd', header: 'Consolidated' },
  { key: 'actions', header: '' },
];

const AttachmentsTab: FC<Props> = ({ fspId }) => {
  const [rows, setRows] = useState<FspAttachmentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { display } = useNotification();

  useEffect(() => {
    if (!fspId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getFspAttachments(fspId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Attachments load failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fspId]);

  const handleDownload = async (attachmentId: string, fallbackName: string) => {
    if (downloadingId) return;
    setDownloadingId(attachmentId);
    try {
      await downloadFspAttachment(fspId, attachmentId, fallbackName);
    } catch (e) {
      display({
        kind: 'error',
        title: 'Download failed',
        subtitle: e instanceof Error ? e.message : 'Unknown error',
        timeout: 7000,
      });
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading && !rows) {
    return (
      <div className="fsp-info__loading" role="status" aria-live="polite">
        <Loading description="Loading attachments…" withOverlay={false} />
      </div>
    );
  }
  if (error) return <p className="fsp-info__error">{error}</p>;
  if (!rows || rows.length === 0) {
    return <p className="fsp-info__placeholder">No attachments on this FSP.</p>;
  }

  const tableRows = rows.map((r, i) => ({
    id: r.fspAttachmentId ?? `row-${i}`,
    category: dash(r.category),
    attachmentName: dash(r.attachmentName),
    attachmentDescription: dash(r.attachmentDescription),
    attachmentSize: dash(r.attachmentSize),
    fspAmendmentNumber: dash(r.fspAmendmentNumber),
    consolidatedInd: r.consolidatedInd === 'Y' ? 'Yes' : 'No',
    actions: '',
    __attachmentId: r.fspAttachmentId,
    __fileName: r.attachmentName,
  }));

  return (
    <section className="fsp-info__tile fsp-info__tile--full">
      <header className="fsp-info__tile-header">
        <h2 className="fsp-info__section-title">Attachments</h2>
      </header>
      <div className="bordered-table">
        <DataTable rows={tableRows} headers={HEADERS}>
          {({ rows: r, headers, getTableProps, getHeaderProps, getRowProps }) => (
            <TableContainer>
              <Table {...getTableProps()} size="md" useZebraStyles>
                <TableHead>
                  <TableRow>
                    {headers.map((h) => (
                      <TableHeader {...getHeaderProps({ header: h })} key={h.key}>
                        {h.header}
                      </TableHeader>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {r.map((row) => {
                    const source = tableRows.find((t) => t.id === row.id);
                    const attachmentId = source?.__attachmentId ?? null;
                    const fallbackName = source?.__fileName ?? row.id;
                    const isDownloading = downloadingId === attachmentId;
                    return (
                      <TableRow {...getRowProps({ row })} key={row.id}>
                        {row.cells.map((cell) => {
                          if (cell.info.header === 'actions') {
                            return (
                              <TableCell key={cell.id}>
                                {attachmentId ? (
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    renderIcon={Download}
                                    iconDescription={
                                      isDownloading ? 'Downloading…' : 'Download'
                                    }
                                    hasIconOnly
                                    disabled={isDownloading}
                                    onClick={() =>
                                      void handleDownload(attachmentId, fallbackName)
                                    }
                                  />
                                ) : null}
                              </TableCell>
                            );
                          }
                          return <TableCell key={cell.id}>{cell.value as string}</TableCell>;
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      </div>
    </section>
  );
};

export default AttachmentsTab;
