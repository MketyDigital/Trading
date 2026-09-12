alter table public.trade_accounts
  add column if not exists live_execution_enabled boolean not null default false;

alter table public.trading_runtime_controls
  drop constraint if exists trading_runtime_controls_known_key;

alter table public.trading_runtime_controls
  add constraint trading_runtime_controls_known_key
  check (control_key in (
    'broker_execution_enabled',
    'trading_access_enabled',
    'live_broker_execution_enabled'
  ));

insert into public.trading_runtime_controls(control_key, enabled, updated_by, updated_at)
values
  ('trading_access_enabled', true, 'migration', now()),
  ('live_broker_execution_enabled', false, 'migration', now())
on conflict (control_key) do nothing;

comment on column public.trade_accounts.live_execution_enabled is
  'Explicit per-account opt-in for real-money/live broker execution. Demo execution does not require this flag.';
