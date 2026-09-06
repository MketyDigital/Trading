# Gate 6 Demo Probe Trigger

This file is the only push-path trigger for the isolated Gate 6 demo connectivity workflow.

The workflow supports two exact commit-message markers and runs only one platform probe at a time:

- `demo: probe mt5 gate 6`
- `demo: probe ctrader gate 6`

Both probes are connectivity/source acceptance only. They force probe mode, force the platform demo-order flag to `false`, and keep `BROKER_EXECUTION_ENABLED=false`.

No Supabase delivery store, Trading workspace, Cloudflare credential, Wrangler command, broker order lifecycle, or real-money execution is available in this workflow.

Required GitHub `staging` environment secrets for MT5:
- `MT5_BRIDGE_URL`
- `MT5_BRIDGE_SECRET`
- `MT5_ACCOUNT_ID`
- `MT5_EXPECTED_DEMO_SERVER`

Required GitHub `staging` environment secrets for cTrader:
- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`
- `CTRADER_ACCESS_TOKEN`
- `CTRADER_ACCOUNT_ID`

Do not place secret values in this file, commits, logs, issues, or chat. The optional demo symbol defaults to `XAUUSD`.

MT5 connectivity probe attempt: 2026-09-06 production-readiness audit; order testing and broker execution remain disabled.
