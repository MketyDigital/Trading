# Gate 7 Demo Destination Trigger

This file is the intentional path trigger for protected Gate 7 broker-demo destination lifecycle acceptance.

The workflow is inert unless the head commit message is exactly one of:

- `demo: lifecycle mt5 gate 7`
- `demo: lifecycle ctrader gate 7`

Each marker runs only its matching broker against the protected `staging` environment after mandatory tests pass.

Safety contract:
- demo accounts only;
- explicit lifecycle mode and explicit demo-order gate;
- persistent Supabase destination idempotency required;
- `BROKER_EXECUTION_ENABLED=false` remains pinned;
- no Cloudflare deployment or Wrangler action;
- default lifecycle size is `0.01` lots, overrideable only through protected environment variables when broker demo minimum/step requires it;
- never use either marker for a live/real-money account.

Ordinary edits to this file with any other commit message may run the workflow test job, but both broker lifecycle jobs remain skipped.
