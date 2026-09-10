# Mkety cTrader Cloud Auto Trader gateway

This service is a transport adapter for the existing Mkety Worker execution system. It is not a second trading engine. The Worker remains authoritative for signal processing, risk, account safety gates and dispatch. The gateway only maintains authenticated cTrader Cloud cBot sessions and delivers canonical Worker commands.

## Production topology

- `trade.mkety.com` / Cloudflare Worker: existing Mkety application and execution orchestration.
- Gateway control API: HTTPS through the normal Coolify reverse proxy to container port `8790`.
- cTrader Cloud WebSocket: `wss://<gateway-host>:25345/v1/cbot`.
- Caddy terminates TLS specifically on public TCP port `25345` and proxies to the Node gateway on internal port `25346`.
- The DNS record used for the cBot hostname must be **DNS-only**, not Cloudflare-proxied, because Cloudflare's standard proxy does not proxy port `25345`.

The stack in `deploy/coolify/docker-compose.yml` is intended for the existing Azure VM running Coolify.

## Required production configuration

Configure these values in Coolify as secrets/environment variables. Do not commit real values to Git:

- `CBOT_PUBLIC_HOST`: DNS-only hostname resolving directly to the Azure VM.
- `ACME_EMAIL`: certificate contact email.
- `CLOUDFLARE_DNS_API_TOKEN`: Cloudflare token scoped only to DNS editing for the relevant zone. Caddy uses DNS-01 validation so it can obtain and renew the certificate used on port `25345` without owning ports `80` or `443`.
- `CBOT_TOKEN_SIGNING_KEY`: strong independent random secret used to verify Mkety-issued cBot connection tokens.
- `CBOT_CONTROL_SECRET`: strong independent random secret used by the Worker to authenticate to the gateway control API.
- `CBOT_COMMAND_TIMEOUT_MS`: optional; defaults to `8000`.

## Coolify deployment

Create a Docker Compose application from this repository and point it at:

`ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`

Expose the `gateway` service's port `8790` through a normal Coolify HTTPS domain, for example `https://cbot-control.mkety.com`. Do not expose port `8790` directly on the VM firewall.

The `caddy` service publishes only TCP `25345` on the VM. Ensure Azure Network Security Group rules and the VM firewall allow inbound TCP `25345` from the Internet. Caddy proxies that TLS WebSocket traffic to `gateway:25346` on the private Docker network.

Set the Worker production configuration to:

- `CTRADER_CBOT_GATEWAY_URL=https://<Coolify-control-domain>`
- `CTRADER_CBOT_WS_URL=wss://<CBOT_PUBLIC_HOST>:25345/v1/cbot`
- Worker secret `CBOT_TOKEN_SIGNING_KEY` equal to the gateway signing key.
- Worker secret `CBOT_CONTROL_SECRET` equal to the gateway control secret.

The control and signing secrets are server-side only. The dashboard may display a generated connection token for the customer's cBot, but it must never expose the gateway control secret.

## Safety

Creating or syncing a cBot connection does not enable trading. New cBot accounts remain inactive, execution-disabled and kill-switched until the existing Mkety account controls are deliberately enabled. Keep `CTRADER_LIVE_TRADING_ENABLED=false` during deployment and acceptance testing. Use a cTrader demo account for the first end-to-end test.

## Health checks

The gateway exposes unauthenticated `GET /health` on the control service and returns only service health metadata. Connection identity and command endpoints require the control bearer secret.

After deployment, verify all of the following before adding the Worker variables:

1. The control URL returns HTTP 200 from `/health` over HTTPS.
2. A TLS handshake succeeds against `<CBOT_PUBLIC_HOST>:25345` using the public hostname.
3. The WebSocket endpoint is reachable at `/v1/cbot`.
4. A demo cBot authenticates with a Mkety-issued token and identity sync reports the actual account number/broker/environment.
5. Live trading remains disabled during acceptance.
