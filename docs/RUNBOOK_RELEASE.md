# Release runbook — ACC to PRD

This is the operational intent. Exact commands/registry paths are filled in during M7 deployment implementation.

## ACC candidate

1. Confirm CI green.
2. Record candidate Git SHA/release identifier.
3. Build/publish immutable web/server/worker images once.
4. Deploy those exact images to ACC.
5. Apply ACC migrations in controlled step.
6. Verify health endpoints.
7. Run smoke tests.
8. Run Quick Timer -> Operator -> Speaker Board realtime test.
9. Run disconnect/reconnect/resync test.
10. Mark candidate accepted/rejected.

## PRD promotion

1. Confirm accepted ACC image identifiers/digests.
2. Check current production status and avoid unintended live-show interruption.
3. Back up database according to policy when migration risk requires it.
4. Promote the exact accepted image versions to PRD; do not rebuild.
5. Apply production migration step.
6. Start/update Compose services.
7. Run health and smoke tests.
8. Monitor logs/realtime connections.
9. Record release result.

## Failure

Do not improvise destructive database rollback. Decide between service rollback and forward fix based on migration compatibility. Preserve logs and release identifiers for diagnosis.
