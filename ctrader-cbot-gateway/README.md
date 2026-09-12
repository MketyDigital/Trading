# Mkety cTrader + MT5 outbound gateway

This service is a transport adapter for the existing Mkety Worker execution system. It is not a second trading engine. The Worker remains authoritative for signal processing, persisted routing, risk, account safety gates and broker dispatch decisions. The gateway maintains authenticated broker-terminal sessions and delivers canonical Worker commands.

`src/bootstrap.js` starts both broker transports:

- cTrader Cloud Auto Trader WebSocket: `/v1/cbot`
- MT5 outbound connector WebSocket: `/v1/mt5`

The Worker-facing control routes stay on the private/authenticated control service.

## Production topology

- `trade.mkety.com` / Cloudflare Worker: Mkety application and execution orchestration.
- Gateway control API: HTTPS through the normal Coolify reverse proxy to container port `8790`.
- Public broker WebSocket listener: `wss://<gateway-host>:25345`.
- cTrader endpoint: `wss://<gateway-host>:25345/v1/cbot`.
- MT5 endpoint: `wss://<gateway-host>:25345/v1/mt5`.
- Caddy terminates TLS on public TCP port `25345` and proxies to the Node gateway on internal port `25346`.
- The DNS record used for the broker WebSocket hostname must be **DNS-only**, not Cloudflare-proxied, because Cloudflare's standard proxy does not proxy port `25345`.

The stack in `deploy/coolify/docker-compose.yml` is intended for the existing Azure VM running Coolify. Gateway deployment is separate from Cloudflare Worker deployment; deploying the Worker does not deploy or prove the health of this gateway.

## Required production configuration

Configure these values in Coolify as secrets/environment variables. Do not commit real values to Git:

- `CBOT_PUBLIC_HOST`: DNS-only hostname resolving directly to the Azure VM.
- `ACME_EMAIL`: certificate contact email.
- `CLOUDFLARE_DNS_API_TOKEN`: Cloudflare token scoped only to DNS editing for the relevant zone. Caddy uses DNS-01 validation so it can obtain and renew the certificate used on port `25345` without owning ports `80` or `443`.
- `CBOT_TOKEN_SIGNING_KEY`: strong independent random secret used to verify Mkety-issued cTrader/MT5 connection tokens.
- `CBOT_CONTROL_SECRET`: strong independent random secret used by the Worker to authenticate to gateway control routes.
- `CBOT_COMMAND_TIMEOUT_MS`: optional; defaults to `8000`.

## Coolify deployment

Create a Docker Compose application from this repository and point it at:

`ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`

Expose the `gateway` service's port `8790` through a normal Coolify HTTPS domain. Do not expose port `8790` directly on the VM firewall.

The `caddy` service publishes only TCP `25345` on the VM. Ensure Azure Network Security Group rules and the VM firewall allow inbound TCP `25345` from the Internet. Caddy proxies TLS WebSocket traffic to `gateway:25346` on the private Docker network.

Set Worker production configuration to the gateway control URL plus broker WebSocket URL. For the current production hostname, the expected MT5 public endpoint is:

```text
wss://cbot.mkety.com:25345/v1/mt5
```

and cTrader remains:

```text
wss://cbot.mkety.com:25345/v1/cbot
```

The signing/control secrets are server-side only. The dashboard may display one-time customer pairing material but must never expose the gateway control secret.

## Authority boundary

The gateway authenticates a terminal session and reports observed terminal identity. It does not grant trading authority. A connector-local reconnect token authenticates only the transport session.

Immediately before dispatch, the Worker reloads durable source/workspace/account state and rechecks source authorization, account/provider state, explicit route, account activation, execution flag, kill switch and risk/symbol policy. Gateway connectivity cannot bypass those checks.

## Safety

Creating or syncing either cTrader or MT5 connectivity does not enable trading. New accounts remain inactive, execution-disabled and kill-switched until existing Mkety controls are deliberately enabled. Keep live trading disabled during deployment/acceptance and use demo accounts for first end-to-end broker tests.

Do not change the persisted Mkety owner/master broker switch merely to deploy or test gateway connectivity.

## Health and acceptance checks

The gateway exposes unauthenticated `GET /health` on the control service and returns only service-health metadata. Connection identity and command/control routes require the control bearer secret.

After deployment, verify all of the following before broker acceptance:

1. The control URL returns HTTP 200 from `/health` over HTTPS.
2. A TLS handshake succeeds against `<CBOT_PUBLIC_HOST>:25345` using the public hostname.
3. `/v1/cbot` accepts a valid demo cTrader pairing session.
4. `/v1/mt5` accepts a valid demo MT5 connector pairing session.
5. cTrader identity sync reports the actual account number/broker/environment and account-specific symbol data.
6. MT5 identity sync reports the actual account number/server/broker/environment and terminal symbol catalog.
7. Invalid/expired/replayed credentials and account mismatches fail closed.
8. Live/real-money execution remains disabled during acceptance unless a separately reviewed live phase explicitly authorizes it.

A green Worker deployment is not evidence that these gateway checks passed; verify the independently deployed gateway itself.
