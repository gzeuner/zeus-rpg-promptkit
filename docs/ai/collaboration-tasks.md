# Local Collaboration Tasks

Collaboration tasks provide a revisioned local workspace for human, agent, and
reviewer notes. Tasks are stored under `.zeus/collaboration/`; they do not
grant approval, remote access, or source-of-truth status. Local process queries
require an explicit workspace-relative catalog and run in a bounded worker.

```text
node cli/zeus.js agent task create --goal "What does PROGRAM:ORDERPGM do?" --catalog ./output/process-candidates.json --json
node cli/zeus.js agent task list --json
node cli/zeus.js agent task show --id <task-id> --json
node cli/zeus.js agent task message --id <task-id> --expected-revision <revision> --text "Check the evidence links" --json
node cli/zeus.js agent task run --id <task-id> --expected-revision <revision> --json
node cli/zeus.js agent task handoff --id <task-id> --json
node cli/zeus.js agent task cancel --id <task-id> --expected-revision <revision> --json
node cli/zeus.js agent task recover --id <task-id> --expected-revision <revision> --json
```

Every mutation requires the current revision. Concurrent or stale edits fail
closed; task files use an integrity hash and a local lock. Recovery is allowed
only after the recorded local process owner is verifiably gone. A cancelled or
completed task cannot be rerun until a new request moves it back to `ready`.

Provider discovery and preview are separate from task execution. Provider
execution is disabled by default, and the `zeus.agent.task` MCP tool is omitted
from the default MCP allowlist because it can create or update local task
records. A host must opt in explicitly. Even an enabled provider call requires
an explicit provider, model, current revision, and fresh preview hash; returned
text remains advisory and is never promoted into stored knowledge.
