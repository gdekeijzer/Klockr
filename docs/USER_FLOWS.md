# Key user flows

## Flow A — Anonymous Quick Timer

1. User opens product.
2. Chooses New Timer.
3. Enters `05:00`.
4. System creates anonymous Show + default Program Queue + timed Queue Item.
5. User presses START.
6. User can open/share Speaker Board.
7. Show remains claimable before expiry.

## Flow B — Grow timer into a Show

1. User adds more Queue Items.
2. Adds title/speaker/notes/durations.
3. Reorders items.
4. Configures current/next behavior.
5. Optionally adds Groups and warning overrides.

No migration into a different product mode is required.

## Flow C — Multi-queue production

1. Add Audio/Stage/Lighting Queue presets.
2. Add discipline-specific items.
3. Relate an Audio item to a Program anchor with an offset.
4. Master displays all peer Queues.
5. Each Queue can maintain its own current item.

## Flow D — Live overrun

1. Speaker is running.
2. Operator adjusts time or speaker overruns.
3. Actual Show State changes.
4. Strict: system reports behind; future planned times remain reference.
5. Sliding: projected schedule can move; affected linked items are clearly marked/updated.
6. Operator remains in final control.

## Flow E — Device pairing

1. Device opens pairing page.
2. Receives short-lived code.
3. Master enters/selects code.
4. Assigns Board.
5. Device receives persistent scoped credential + Device ID.
6. Device reconnects later and resumes assigned Board.

## Flow F — Anonymous claim

1. Master shows expiry countdown and Claim Show.
2. User authenticates/creates account.
3. Ownership transfers/attaches to account.
4. Public Board links do not become owner credentials.

## Flow G — Emergency lock override

1. Operator encounters locked object during live incident.
2. UI offers Request Unlock if applicable.
3. If user has `lock.emergency_override`, explicit override action is available.
4. User confirms.
5. Lock is bypassed/released per design.
6. Audit event is written.

## Flow H — Wi-Fi interruption on Speaker Board

1. Board has an authoritative running snapshot.
2. Network drops.
3. Existing timer continues locally; layout stays visible.
4. Board indicates reconnect status only as appropriate.
5. Network returns.
6. Board obtains authoritative state/revision and gently resynchronizes.
