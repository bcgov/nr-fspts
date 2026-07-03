# FSPTS Backend (API)

Spring Boot API for the Forest Stewardship Plan Tracking System. A thin,
stateless OAuth2 resource server over the legacy Oracle PL/SQL packages — see
[../docs/architecture.md](../docs/architecture.md) and
[../docs/database.md](../docs/database.md) for the shape and the
stored-procedure pattern that defines it.

- **Java 21**, **Spring Boot 3.5**
- Web (Undertow), WebFlux (FAM identity-lookup client), JDBC (`ojdbc11`),
  Validation, AOP, Cache, Mail, Actuator
- OAuth2 **resource server** (Cognito JWTs) + method security (`@PreAuthorize`)
- Stored-procedure DAOs (no ORM); OpenAPI via springdoc

## Prerequisites

There is **no local database** — the API connects to the shared BC Gov Oracle.
You need:

1. **BC Gov VPN** connected (Oracle reachability).
2. `src/main/resources/application-local.properties` — gitignored; holds the DB
   password, Cognito, and IDIR config the `local` profile reads. (See its
   header comment for the truststore-extraction procedure.)
3. `src/main/resources/cert/jssecacerts` — the Oracle truststore.

## Run

```bash
# From the repo root, the whole stack (recommended):
docker compose up                 # backend :8080 + frontend :3000

# Or natively (requires Maven + a JDK 21):
mvn spring-boot:run               # uses the local profile / application-local.properties
```

- API base: <http://localhost:8080>
- OpenAPI UI: <http://localhost:8080/swagger-ui>
- Health: `/actuator/health`

> The Compose backend has **no hot reload** (spring-boot-devtools isn't on the
> classpath); restart it after Java changes: `docker compose restart backend`.

## Test

```bash
mvn test                          # unit + slice tests
mvn -Dtest=FspApiControllerTest test
```

DAO tests that hit real Oracle packages are kept separate from the
mocked-service slice tests. Security is covered by `FspApiControllerTest`
(role gates), `WorkflowServiceDdmGuardTest`, and `FspAccessGuardTest`.

## Structure

```
src/main/java/ca/bc/gov/nrs/fsp/api/
├── endpoint/        REST interfaces: URL mappings, OpenAPI, @PreAuthorize
├── controller/      @RestController impls of the endpoint interfaces
├── service/         orchestration — one service per domain
├── dao/             stored-procedure wrappers (AbstractStoredProcedureDao + *DaoImpl)
├── struct/          request/response DTOs
├── security/        JWT validation, FsptsRoles, FspAuthorities, FspAccessGuard
├── submission/      XML / GeoJSON parse → validate → preview → persist
├── notification/    email + district-designate digest scheduler
├── exception/       exception→HTTP mapping; ProcErrorMessages (FSP.* codes)
├── util/            RequestUtil (audit user / roles / active-org client number)
├── constants/       URL paths
└── config/          security + app config
```

## Conventions

- **DAOs wrap procs, not tables.** Build positional `CallableStatement`s via
  `AbstractStoredProcedureDao`; bind/read by position. See
  [../docs/database.md](../docs/database.md) for the gotchas (P_ACTION dispatch,
  full-record SAVE, threading roles + client number, amendment-number traps).
- **Authorization** is enforced in three layers — JWT validation, the
  `FspAuthorities` `@PreAuthorize` matrix on write endpoints, and the
  `FspAccessGuard` per-FSP ownership fence. See
  [../docs/roles-and-security.md](../docs/roles-and-security.md).
- **Proc errors** raise `FSP.*` codes; map new ones in `ProcErrorMessages`
  rather than letting them fall through to 500.
- **Uploads are virus-scanned** (ClamAV `clamd` over raw TCP) before parse or
  storage. Locally there's no clamd, so the `local` profile fails open — see
  [../docs/virus-scanning.md](../docs/virus-scanning.md) for config, the
  fail-open policy, and the cross-namespace NetworkPolicy the deploy needs.
- Keep services thin; push business rules to the procs (they own the schema and
  the transitions).
