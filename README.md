# Trading

Mkety Trading runtime repository.

## PR #6 verification note

The `fix/v1-frontend-sync-simulation` branch has completed the repo-controlled V1 frontend/API/database synchronization and safe simulation workstream.

Latest verified runtime/test evidence before this note:

- Trading V1 CI run `34058536767` passed on `6da2232f666ae8129f9909f7604128a5e86e823d`.
- Worker/trading-core tests, pure MT5 bridge tests and pure MTProto Python tests passed.
- Fresh CodeQL is blocked by the repository Code Security default-vs-advanced configuration conflict, not by a confirmed runtime code vulnerability.
- Production promotion, `main` merge, real credentials and real-money execution remain blocked.
