# Virus scanning (ClamAV)

Every uploaded file — the submission XML/GeoJSON **and** each attachment — is
virus-scanned before it is parsed or stored. Scanning is done by a shared
**ClamAV `clamd`** daemon spoken over **raw TCP** using the native `INSTREAM`
socket protocol (port `3310`). It is **not** HTTP — ClamAV has no HTTP API.

## Where it runs in the pipeline

The scan happens on the raw bytes, up front, before any parsing:

```
upload ──▶ VIRUS SCAN ──▶ detect format ──▶ parse ──▶ validate ──▶ persist
           (clamd INSTREAM)
```

| Upload | Scanned in | On rejection |
|--------|-----------|--------------|
| Submission XML / GeoJSON | `SubmissionValidationService.validateAndParse` | Added as a validation error → `422` with the rest of the issues |
| Submission attachments | `FspSubmissionController.submit` (`scanOrThrow`) | `VirusDetectedException` → `422` |
| Standalone attachment upload | `AttachmentsService.upload` (`scanOrThrow`) | `VirusDetectedException` → `422` |

Two rejection codes surface (both `422`), mapped to friendly labels in the SPA's
validation-issues table (`XmlSubmissionPage.tsx`):

| Code | Meaning | UI label |
|------|---------|----------|
| `VIRUS_DETECTED` | clamd reported a signature match | "Virus detected" |
| `VIRUS_SCAN_UNAVAILABLE` | scanner unreachable/errored under a fail-closed policy | "Virus scan unavailable" |

## Fail-open vs fail-closed

When the scanner can't be reached (or errors), the `fsp.clamav.fail-open`
policy decides what happens:

- **fail-closed** (`false`, the default) — reject the upload
  (`VIRUS_SCAN_UNAVAILABLE`). Secure: no upload is ever stored unscanned.
- **fail-open** (`true`) — allow the upload through. Used where a reliable
  clamd isn't available (local dev; ephemeral PR previews that can't reach the
  shared clamd).

An **infected** verdict is always rejected regardless of this policy.

## Configuration

All via env (defaults in `application.properties`):

| Env var | Default | Purpose |
|---------|---------|---------|
| `CLAMAV_ENABLED` | `true` | Master switch. `false` = skip scanning entirely (no-op). |
| `CLAMAV_HOST` | — (**required**) | clamd host, e.g. `clamav.<tools-namespace>.svc.cluster.local`. No default — the deploy fails unless it's set (GitHub **secret** `CLAMAV_HOST` per environment, threaded through `reusable-deploy.yml`). |
| `CLAMAV_PORT` | `3310` | clamd TCP port. |
| `CLAMAV_FAIL_OPEN` | `false` | See above. `true` tolerates a scanner outage. |
| `CLAMAV_CONNECT_TIMEOUT` | `5s` | Socket connect timeout. |
| `CLAMAV_READ_TIMEOUT` | `30s` | Reply read timeout. |

### Startup health check

On boot the backend sends a `PING` to clamd and logs the result (`INFO` when it
replies `PONG`, `WARN` otherwise) so a misconfigured/unreachable scanner is
visible immediately in the logs rather than only on the first upload.

### Per-scan logging

Every scan emits one greppable verdict line carrying the filename and size:

```
clamav scan: 'my-submission.xml' (9581760 bytes) → CLEAN          # INFO
clamav scan: 'evil.pdf' (2048 bytes) → INFECTED (Eicar-Test-Signature) — rejecting   # WARN
clamav scan: 'doc.pdf' (1024 bytes) → UNAVAILABLE (connection refused) — failing CLOSED, rejecting   # WARN
```

## Deployment — reaching clamd across namespaces

clamd runs in the shared **tools** namespace, not the app namespace. The backend's own namespace doesn't restrict egress, so the block is
on the **receiving** side: the clamd pod only accepts traffic that an ingress
`NetworkPolicy` in the tools namespace allows.

`backend/openshift.clamav-netpol.yml` is that policy — an OpenShift Template
that creates, in the tools namespace, an ingress rule letting one app namespace
open TCP 3310 to the clamd pods (`podSelector: app=clamav`, one
`allow-<app-ns>-to-clamav` policy per environment). It is applied by the
**"Allow backend → clamav"** step in `reusable-deploy.yml`, which targets the
tools namespace with a tools-scoped token. The step is skipped unless the tools
secrets are configured, so deploys without ClamAV are unaffected.

### Required GitHub Actions secrets

Set these per GitHub Environment (`dev`, `test`, later `prod`), threaded through
`pr-open.yml` / `merge.yml` → `reusable-deploy.yml`:

| Secret | Value |
|--------|-------|
| `CLAMAV_HOST` | clamd host — **required** for the backend deploy (the template has no default) |
| `OC_NAMESPACE_TOOLS` | the tools namespace where clamd runs (only for the NetworkPolicy step) |
| `OC_TOKEN_TOOLS` | token for a service account in that namespace with `edit` (only for the NetworkPolicy step) |

The app-namespace `oc_token` has no rights in tools, hence the separate token.
Minting one:

```bash
oc -n <tools-namespace> create sa fspts-netpol
oc -n <tools-namespace> adm policy add-role-to-user edit -z fspts-netpol
oc -n <tools-namespace> create token fspts-netpol --duration=8760h
```

The clamd pod selector defaults to `app: clamav`; override without code changes
via `vars.CLAMAV_POD_LABEL_KEY` / `vars.CLAMAV_POD_APP`.

## Local development

There is no clamd locally. Rather than run one, the `local` profile keeps the
scan path wired but **fails open** so offline uploads still work:

```properties
# application-local.properties
fsp.clamav.enabled=true
fsp.clamav.fail-open=true
```

Set `fsp.clamav.enabled=false` instead if you'd rather skip scanning outright.
Without one of these, every local upload is rejected with "Virus scan
unavailable" (the fail-closed default with no reachable clamd). This is also why
the Playwright `fsp-lifecycle` spec needs clamav reachable **or** fail-open
against its target — see [../frontend/e2e/README.md](../frontend/e2e/README.md).

## Code map

| Concern | Code |
|---------|------|
| Policy layer (enable / fail-open, rejection codes, startup PING, logging) | `service/v1/VirusScanner` |
| Low-level clamd client (INSTREAM framing, `scan`, `ping`) | `client/ClamAvClient` |
| Scan result value | `client/ScanResult` |
| Throw-style rejection → `422` | `exception/VirusDetectedException` (+ `RestExceptionHandler`) |
| UI issue labels | `frontend/src/pages/XmlSubmissionPage.tsx` |
| Cross-namespace NetworkPolicy | `backend/openshift.clamav-netpol.yml` |
