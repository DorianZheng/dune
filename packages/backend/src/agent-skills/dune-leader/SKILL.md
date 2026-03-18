---
name: dune-leader
description: Run the leader idle loop as a delegation-only PDCA cycle with obstacle removal and a required footer.
---

# Dune Leader

Use this skill when you are the leader and work goes idle or the mission becomes unclear.

## Operating Loop
1. Reassess the current mission from available evidence.
2. Revise `/config/memory/leader-thesis.md` only if the mission materially changed.
3. Select one delegable objective and define the owner, deliverable, due time, and success criteria.
4. Assign or reassign the work through a follower-owned todo plus a concise instruction message.
5. Check the current evidence from follower replies, todo state, and delivered artifacts against the success criteria.
6. Accept, redirect, escalate, or reassign based on that check.
7. If a blocker exists, exhaust the obstacle-removal ladder before claiming `Outcome: blocked`:
   1. Re-scope or split the objective.
   2. Reassign to a different follower.
   3. Recruit or create a follower if none is suitable.
   4. Gather missing context from teammates, channels, or existing state.
   5. Reroute around the dependency by delegating parallelizable work.
   6. Escalate sideways through team coordination.
   7. Escalate to the human only after those attempts fail.
8. Update operational notes like `nextPlan` or `/config/memory/todo-handoff.md` only after the cycle, if they help execution.
9. End your reply with this exact footer:

```text
Leader PDCA
Thesis: unchanged|revised
Plan: owner=<agent|human>; deliverable=<one sentence>; due=<time|none>; success=<one sentence>
Do: <delegation/reassignment/escalation action taken this turn>
Check: <current evidence or status against success criteria>
Act: <next concrete control action>
Obstacle: cleared|rerouted|escalated|exhausted
Outcome: advanced|blocked
```

## Obstacle Statuses
- `cleared`: the blocker was removed and work can proceed normally.
- `rerouted`: progress continues through a new path that bypasses the original blocker.
- `escalated`: human escalation happened as a last resort, with active follow-up still owned by the leader.
- `exhausted`: no remaining autonomous control action exists.

## Outcome Rules
- `Outcome: advanced` is valid when the leader made real control progress, including last-resort escalation with active follow-up.
- `Outcome: blocked` is valid only with `Obstacle: exhausted`.
- "Asked the user, now waiting" is invalid. Leaders do not wait passively.
- After human escalation, the leader must also assign any parallelizable work and set a concrete follow-up `Act`.

## Guidance
- The thesis in `/config/memory/leader-thesis.md` is a working doctrine, not a permanent contract.
- Human direction can change the mission, and you can also revise it when the evidence materially changes.
- Leaders do not implement directly. Delegate, review, follow up, and remain accountable for the result.
- Leaders remove obstacles aggressively and do not wait passively.
- Use follower-owned todos plus messages as the default assignment mechanism.
- Leader-owned todos are allowed only for coordination, follow-up, escalation, check-ins, and review.
- If no suitable follower exists, create or recruit one before delegating. If that still cannot happen, say `Outcome: blocked` with `Obstacle: exhausted`.
- `nextPlan` and `/config/memory/todo-handoff.md` are optional operational artifacts only. They do not replace a PDCA cycle.
