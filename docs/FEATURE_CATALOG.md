# Functional catalog

Status: **V1**, **Later**, or **Foundation** (design now, richer implementation later).

## Entry / lifecycle

| ID       | Function                                              | Status |
| -------- | ----------------------------------------------------- | ------ |
| LIFE-001 | Create anonymous New Show / Quick Timer               | V1     |
| LIFE-002 | Default anonymous retention of 7 days                 | V1     |
| LIFE-003 | Warn authorized user before anonymous expiry          | V1     |
| LIFE-004 | Claim anonymous Show into account                     | V1     |
| LIFE-005 | Safe cleanup that does not delete an active live Show | V1     |
| LIFE-006 | Platform Admin management of anonymous Shows          | Later  |

## Event / Room / Show

| ID       | Function                                  | Status |
| -------- | ----------------------------------------- | ------ |
| EVT-001  | Optional Event container                  | V1     |
| EVT-002  | Optional Room/Area                        | V1     |
| EVT-003  | Assign a Show to at most one Room         | V1     |
| EVT-004  | Duplicate Show for independent Room usage | V1     |
| EVT-005  | Event Dashboard                           | V1     |
| SHOW-001 | Standalone Show without Event/Room        | V1     |
| SHOW-002 | Show defaults inherited by Queues/Items   | V1     |

## Queues / Items

| ID       | Function                                        | Status |
| -------- | ----------------------------------------------- | ------ |
| QUE-001  | One or more peer Queues per Show                | V1     |
| QUE-002  | Queue presets such as Program/Audio/Stage       | V1     |
| QUE-003  | Per-Queue current/next                          | V1     |
| QUE-004  | Drag/drop reorder and move                      | V1     |
| QUE-005  | Duplicate Queue/Group/Item where allowed        | V1     |
| ITEM-001 | Universal Queue Item                            | V1     |
| ITEM-002 | UI presets Add Timer/Speaker/Note/Break/Cue     | V1     |
| ITEM-003 | Notes on an Item                                | V1     |
| ITEM-004 | Standalone note-like Queue Item                 | V1     |
| ITEM-005 | Tags for organization/filtering                 | V1     |
| ITEM-006 | Active/inactive/skip state                      | V1     |
| ITEM-007 | Groups as real containers                       | V1     |
| REL-001  | Relative relationship across peer Queues        | V1     |
| REL-002  | Preserve offset under applicable schedule shift | V1     |
| REL-003  | Explain affected relations on move              | V1     |

## Timers

| ID      | Function                                       | Status |
| ------- | ---------------------------------------------- | ------ |
| TIM-001 | Countdown                                      | V1     |
| TIM-002 | Count-up/overtime after zero                   | V1     |
| TIM-003 | START/PAUSE/RESUME/STOP                        | V1     |
| TIM-004 | END distinct from STOP                         | V1     |
| TIM-005 | END/NEXT behavior                              | V1     |
| TIM-006 | Positive/negative adjustments                  | V1     |
| TIM-007 | Multiple simultaneous running timers           | V1     |
| TIM-008 | Normal/warning/critical/overtime visual states | V1     |
| TIM-009 | Absolute/percentage warning thresholds         | V1     |
| TIM-010 | Show -> Queue -> Item override inheritance     | V1     |
| TIM-011 | Visible indication of item/queue override      | V1     |
| TIM-012 | Manual start                                   | V1     |
| TIM-013 | Soft Scheduled start                           | V1     |
| TIM-014 | Previous END start                             | V1     |
| TIM-015 | External/API start                             | V1     |

## Scheduling

| ID      | Function                                   | Status |
| ------- | ------------------------------------------ | ------ |
| SCH-001 | Strict / Operator Controlled               | V1     |
| SCH-002 | Sliding / Free projection                  | V1     |
| SCH-003 | Baseline vs projected vs actual time       | V1     |
| SCH-004 | Fixed time anchors                         | V1     |
| SCH-005 | Ahead/on-time/behind status                | V1     |
| SCH-006 | Calm pending/changed UI during live shifts | V1     |
| SCH-007 | Automatic schedule recovery                | Later  |

## Boards / messages

| ID      | Function                                             | Status |
| ------- | ---------------------------------------------------- | ------ |
| BRD-001 | Board as independent data presentation               | V1     |
| BRD-002 | Speaker/Stage/FOH/Agenda/Public presets              | V1     |
| BRD-003 | Configure visible components                         | V1     |
| BRD-004 | Constrained layout/typography/branding customization | V1     |
| BRD-005 | Flexible source/filter selection                     | V1     |
| BRD-006 | Audience membership                                  | V1     |
| BRD-007 | Advanced free-form Board Designer                    | Later  |
| MSG-001 | Send ad-hoc Message to selected audiences            | V1     |
| MSG-002 | Clear/auto-expire ad-hoc Message                     | V1     |

## Master / Operator / locks

| ID       | Function                              | Status |
| -------- | ------------------------------------- | ------ |
| UI-001   | Master planning + broad control       | V1     |
| UI-002   | Focused Operator live cockpit         | V1     |
| LOCK-001 | Lock Event/Room/Show/Queue/Group/Item | V1     |
| LOCK-002 | Request Unlock                        | V1     |
| LOCK-003 | Permission-gated Emergency Override   | V1     |
| LOCK-004 | Audit emergency override              | V1     |

## Devices / sharing

| ID      | Function                                    | Status           |
| ------- | ------------------------------------------- | ---------------- |
| SHR-001 | Board direct share link                     | V1               |
| SHR-002 | QR sharing                                  | V1               |
| SHR-003 | Central share overview                      | V1               |
| SHR-004 | Revoke/regenerate share                     | V1               |
| SHR-005 | Optional share PIN/advanced expiry policies | Foundation/Later |
| DEV-001 | Short-code device pairing                   | V1               |
| DEV-002 | Persistent unique Device ID                 | V1               |
| DEV-003 | Device online/last-seen state               | V1               |
| DEV-004 | Assign/reassign Board                       | V1               |
| DEV-005 | Revoke/remove Device                        | V1               |

## Realtime / offline

| ID     | Function                                          | Status |
| ------ | ------------------------------------------------- | ------ |
| RT-001 | Authoritative Show State                          | V1     |
| RT-002 | Realtime state transitions to Boards              | V1     |
| RT-003 | Local timer rendering from timestamps             | V1     |
| RT-004 | Board keeps useful output during brief disconnect | V1     |
| RT-005 | Reconnect authoritative resync                    | V1     |
| RT-006 | Operational connection-state indication           | V1     |

## Users / permissions

| ID       | Function                                     | Status |
| -------- | -------------------------------------------- | ------ |
| RBAC-001 | Permission-based authorization               | V1     |
| RBAC-002 | Initial Owner/Master/Operator/Viewer presets | V1     |
| RBAC-003 | Extensible role model                        | V1     |
| RBAC-004 | Advanced custom-role editor                  | Later  |
| RBAC-005 | Board credentials separate from user roles   | V1     |

## External integrations

| ID      | Function                                   | Status     |
| ------- | ------------------------------------------ | ---------- |
| API-001 | Basic scoped external HTTP API             | V1         |
| API-002 | Bidirectional generic integration boundary | Foundation |
| INT-001 | OSC                                        | Later      |
| INT-002 | Bitfocus Companion                         | Later      |
| INT-003 | QLab                                       | Later      |
| INT-004 | MIDI                                       | Later      |
| INT-005 | Local Agent                                | Later      |
| INT-006 | Advanced Action engine                     | Later      |
