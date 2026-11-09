# Observability

## Structured logs

Every state-changing command should be traceable with fields such as:

- command/correlation ID;
- actor type/user/device/API client;
- Event/Show/Queue/Item IDs as applicable;
- command name;
- result/error code;
- revision before/after where useful;
- duration.

Never log secret tokens.

## Audit log vs debug log

Audit events are product/security records for meaningful actions such as:

- ownership claim;
- permission/member changes;
- share/device revocation;
- lock/emergency override;
- destructive deletion/cleanup;
- API credential creation/revocation.

Debug/operational logs are separate and may have shorter retention.

## Metrics to plan

- active realtime connections;
- reconnect rate;
- command success/failure/latency;
- revision conflicts;
- anonymous Show creation/cleanup;
- Device online/offline count;
- Board connection failures;
- external Action failures later.

## Health checks

At minimum distinguish:

- process alive;
- database ready;
- realtime service available.

## Client diagnostics

Master may later expose concise diagnostics such as device last seen, connection state, state revision and clock offset for support without overwhelming normal Operator UI.
