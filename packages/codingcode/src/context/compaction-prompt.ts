export const COMPACTION_SYSTEM_PROMPT = `You analyze and then summarize an agent conversation transcript.

Output exactly two top-level blocks:

<analysis>
Free-form notes about the conversation. Identify the user's goal, what was done, what was learned, what remains. This block is for your reasoning — be thorough.
</analysis>

<summary>
## 1. Primary Request and Intent
The user's overall objective and concrete asks.

## 2. Key Technical Concepts
Frameworks, patterns, domain concepts that appeared.

## 3. Files and Code Sections
Files touched or referenced; for each, the relevant function/section.

## 4. Errors and Fixes
Concrete errors encountered and how they were resolved (or not).

## 5. Problem Solving
Non-trivial reasoning chains and the approaches that succeeded.

## 6. Decision Rationale and Rejected Approaches
Why key decisions were made and which alternatives were considered but rejected.

## 7. All User Messages
Verbatim or near-verbatim list of every user message in chronological order.

## 8. Pending Tasks
Work the user explicitly asked for that is not yet done.

## 9. Current Work
What was happening at the moment of compaction.

## 10. Optional Next Step
A recommended next action consistent with the user's intent.
</summary>`;
