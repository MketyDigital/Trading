ALTER TABLE trading_account_followers ADD COLUMN risk_mode TEXT NOT NULL DEFAULT 'fixed_lot';
ALTER TABLE trading_account_followers ADD COLUMN risk_percent TEXT;
ALTER TABLE trading_account_followers ADD COLUMN risk_amount TEXT;
ALTER TABLE trading_account_followers ADD COLUMN risk_basis TEXT NOT NULL DEFAULT 'equity';
