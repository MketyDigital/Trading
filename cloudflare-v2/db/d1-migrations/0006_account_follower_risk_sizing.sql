ALTER TABLE trading_account_followers ADD COLUMN risk_mode TEXT NOT NULL DEFAULT 'fixed_lot' CHECK (risk_mode IN ('fixed_lot','multiplier','fixed_risk','equity_percent','balance_percent'));
ALTER TABLE trading_account_followers ADD COLUMN risk_percent TEXT CHECK (risk_percent IS NULL OR (CAST(risk_percent AS REAL) > 0 AND CAST(risk_percent AS REAL) <= 100));
ALTER TABLE trading_account_followers ADD COLUMN risk_amount TEXT CHECK (risk_amount IS NULL OR CAST(risk_amount AS REAL) > 0);
ALTER TABLE trading_account_followers ADD COLUMN risk_basis TEXT NOT NULL DEFAULT 'equity' CHECK (risk_basis IN ('equity','balance'));
