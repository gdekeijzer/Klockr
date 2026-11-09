# Integrations and Actions

## V1 position

A basic external HTTP API belongs in V1.

OSC, native Companion, QLab, MIDI and the Local Agent do not need to ship in V1.

## Boundary rule

The timer/show engine never depends on a specific integration.

External input invokes application commands. Outbound integration work listens to explicit domain/application events and executes Actions.

## Future inbound capabilities

Examples:

- START TIMER;
- PAUSE/RESUME/STOP;
- GO ITEM;
- END ITEM;
- NEXT/PREVIOUS;
- SET CURRENT;
- ADD/ADJUST TIME;
- SEND MESSAGE.

## Future Actions

An Action may be configured on triggers such as:

- on start;
- on pause/resume;
- on warning;
- on critical;
- on overtime;
- on end;
- on manual GO.

Potential transports:

- HTTP/Webhook;
- OSC;
- Companion;
- QLab;
- MIDI.

## Failure behavior

Integrations are non-blocking by default.

If an Action fails:

- core Show State remains valid;
- timer continues;
- failure is recorded;
- Operator receives an appropriate concise warning;
- Master can inspect details;
- optional retry can be a future policy.

Only an explicitly designed future blocking Action may block show flow.

## Feedback

Future integrations are bidirectional. Example Companion feedback:

- running -> button state;
- warning/critical/overtime -> color/state feedback;
- current item -> label;
- ahead/behind -> status.

## Local Agent (later)

For protocols unavailable directly from the cloud/browser:

`Cloud service <-> secure connection <-> Local Agent <-> LAN protocols`

The Agent is optional and should have identity, connection state, allowed protocols and logs. Its outage never disables normal web timer operation.
