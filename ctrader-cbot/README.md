# Mkety Cloud Auto Trader

`MketyCloudAutoTrader.algo` is the cTrader Cloud execution adapter for the existing Mkety Trading Worker. It does not contain Mkety's signal-processing or risk engine; those remain in the Worker.

## Customer setup

1. In Mkety Trading, open Connections and choose **Cloud Auto Trader** under cTrader.
2. Create the connection. Mkety displays a WebSocket URL and a connection token once.
3. Download `MketyCloudAutoTrader.algo` from the approved Mkety release/download location and open it with cTrader.
4. Create an instance of **Mkety Cloud Auto Trader** on the cTrader account you want to connect.
5. Enter the WebSocket URL in **Mkety Gateway** and the one-time-displayed value in **Connection Token**.
6. Start the cBot. It authenticates using the actual cTrader account number, broker and demo/live environment.
7. Return to Mkety Trading and click **Sync cBot identity**. Mkety stores the authenticated broker identity while leaving all trading safety controls unchanged.
8. Only after verifying the connection should an authorised Mkety user deliberately enable the existing account/execution controls.

The cBot can subsequently run in cTrader Cloud; customers do not need a separate VPS for this connection method.

## Security and safety

- The gateway URL must be `wss://` on port `25345`.
- Commands are scoped to the Mkety connection row and to the authenticated cTrader broker account number.
- The cBot independently checks the broker account number before executing a delivered command.
- Command IDs are replay-protected and commands expire quickly.
- New Mkety cBot connections are inactive, execution-disabled and kill-switched by default.
- Live cTrader execution is additionally gated by Mkety's existing production controls.

## Building

The project uses the official `cTrader.Automate` package. A Release build generates an `.algo` file automatically. The repository's `cTrader cBot Release` workflow builds without source or debug symbols, calculates a SHA-256 checksum and publishes version-tagged release assets for tags matching `ctrader-cbot-v*`.
