# Retrospective: What I Would Do Differently

Five audit rounds to reach a clean codebase. Rounds 1-4 found 24→6→3→1 issues progressively. Round 5 found 1 more. This document captures the patterns of wasted time and what a single efficient pass would look like.

## The core mistake: auditing by file instead of by pattern

Each round read files top-to-bottom looking for "anything wrong." This is slow and unreliable because the same class of bug can exist in 5 files and you only notice it in 2. The fix is to audit by *bug class* across the entire codebase at once.

### Example: the port mismatch saga

The registers mock runs on port 8081. Three files defaulted to 8080 (the OnGuard port):

| File | Round found | How it should have been found |
|------|-------------|-------------------------------|
| `verification.ts` | Round 3 | `grep -r "8080" packages/convex-*` in Round 1 |
| `brreg.ts` | Round 4 | Same grep |
| (already correct: `badges.ts` → 8080 for OnGuard) | — | Same grep confirms this one is correct |

**One grep in round 1 would have eliminated two entire audit rounds.**

### Example: the personId inconsistency

`checkNkr` used personId-first lookup. `checkFreg` did not, even though:
- The action already accepted `personId` as an argument
- The FREG mock already supported `?personId=` queries
- The two functions sat 10 lines apart in the same file

Found in round 5. Should have been caught by asking: "do all register check functions use the same lookup strategy?"

**Pattern: when you fix a function, check its siblings for the same issue.**

## The delegation trust problem

Rounds 1-4 used sub-agents for verification. The user said "I do not believe you" after round 4. Round 5 read every file directly and was the most productive round despite being a "re-check."

**Lesson: for verification tasks, direct reading beats delegation.** Sub-agents are good for research and exploration. They are bad for "prove to me this is correct" because:
1. You can't show your work — the user sees a summary, not the evidence
2. Sub-agents optimize for speed, not thoroughness
3. Trust requires visible effort

## The "file not read" tax

Multiple edits failed with "File has not been read yet" because I tried to edit files I'd only read in a previous context or via a sub-agent. Each failure cost a round-trip.

**Rule: always read a file in the current turn before editing it. No exceptions. Budget for this.**

## What one efficient pass looks like

If I were starting this audit fresh with everything I know now:

### Step 1: Pattern-based sweeps (grep across entire codebase)

These catch entire classes of bugs at once:

```
grep -r "8080" packages/convex-*     → find all port mismatches
grep -r "localhost:3210" packages/    → verify Convex URL assignments
grep -r "workspace:\*" packages/      → verify @vms/shared dependency
grep -r "react-jsx" packages/convex-* → find spurious JSX config
grep -rn "function check" packages/convex-restricted/ → find all register check functions
```

Five greps. Catches 8 of the 25 issues directly.

### Step 2: Contract verification (does caller match callee?)

For every cross-service call, verify both ends exist and agree:

| Caller | Callee | Check |
|--------|--------|-------|
| `diode-gateway` calls `diodeOutbox:listPending` | Does `diodeOutbox.ts` export `listPending`? | Both sides |
| `diode-gateway` calls `diodeInbox:receive` | Does `diodeInbox.ts` export `receive`? | Both sides |
| `brreg.ts` reads `data.navn` | Does mock return `navn`? | Field names |
| `verification.ts` reads `data.status` | Does NKR mock return `status`? | Field names + values |
| `badges.ts` posts to OnGuard | Does mock handle that `type_name`? | Endpoint paths |

This catches: missing function files, field name mismatches, port mismatches (the URL is part of the contract).

### Step 3: State machine completeness check

Read the state machine definition once. Then verify:
- Every state mentioned in code exists in the transitions map
- Terminal states have `[]`
- Cancellation is reachable from all non-terminal, non-completed states
- The shared types file lists the same states

### Step 4: Scoring model cross-reference

Read the plan document *first*. Then verify the code against it:
- Score values match plan table
- Threshold tiers match plan table (count them — plan says 5, code should have 5)
- Mutual exclusion groups match plan text ("single slot" → only one counts)

### Step 5: Symmetry checks

If both sides of the diode should have the same structure, diff them:
- `convex-unclass/convex/diodeOutbox.ts` vs `convex-restricted/convex/diodeOutbox.ts`
- `convex-unclass/convex/diodeInbox.ts` vs `convex-restricted/convex/diodeInbox.ts`
- Both schemas should have matching diode table definitions

If two functions do the same kind of work, they should use the same approach:
- `checkFreg` and `checkNkr` should both use personId when available

## Time estimate comparison

| Approach | Rounds | Issues missed per round | Total effort |
|----------|--------|------------------------|--------------|
| Actual (file-by-file, 5 rounds) | 5 | 6, 3, 1, 1 | ~165k tokens |
| Pattern-based (1 round) | 1 | 0 | ~40k tokens |

The pattern-based approach is roughly 4x more efficient because:
- Greps are cheaper than reading entire files
- Finding a bug class once finds all instances
- No re-reading files you already checked
- No trust rebuilding with the user

## Rules to internalize

1. **Audit by bug class, not by file.** Grep first, read second.
2. **When you fix something, grep for the same pattern everywhere.** The same mistake rarely appears only once.
3. **Verify contracts end-to-end.** Every cross-service call needs both ends checked.
4. **Check siblings.** If two functions do similar work, they should use the same approach.
5. **Read the spec before the code.** Cross-referencing is more reliable than reading code in isolation.
6. **For verification tasks, show your work.** Read files directly. Don't delegate trust.
7. **Always read before edit.** No exceptions. Budget the extra round-trip.
