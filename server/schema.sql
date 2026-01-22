-- Create the table used by the Dividend Planner API
-- Run this against your MariaDB database (DB_DATABASE)

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_users_email (email)
);

CREATE TABLE IF NOT EXISTS holdings (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  symbol VARCHAR(16) NOT NULL,
  shares DECIMAL(18,6) NOT NULL,
  dividend_per_share DECIMAL(18,6) NOT NULL,
  dividend_frequency VARCHAR(16) NOT NULL,
  include_in_reinvestment TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_holdings_user_created_at (user_id, created_at),
  INDEX idx_holdings_created_at (created_at)
);

-- Simple portfolio positions used by the logged-in Home dashboard

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id int NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  amount DECIMAL(18,6) NOT NULL,
  buy_price DECIMAL(18,6) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_portfolio_user_symbol (user_id, symbol),
  INDEX idx_portfolio_user_updated_at (user_id, updated_at)
);

-- Watchlist (관심 목록)

CREATE TABLE IF NOT EXISTS watchlist_items (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_watchlist_user_symbol (user_id, symbol),
  INDEX idx_watchlist_user_created_at (user_id, created_at)
);

-- Cached EODHD exchange symbol lists (search / metadata)

CREATE TABLE IF NOT EXISTS eodhd_exchange_symbols (
  exchange VARCHAR(16) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  name VARCHAR(255) NULL,
  type VARCHAR(24) NULL,
  currency VARCHAR(16) NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exchange, symbol),
  INDEX idx_eodhd_symbols_exchange_symbol (exchange, symbol),
  INDEX idx_eodhd_symbols_exchange_name (exchange, name)
);

-- Cached EODHD fundamentals (name/type/currency)

CREATE TABLE IF NOT EXISTS eodhd_fundamentals (
  symbol VARCHAR(32) NOT NULL,
  payload LONGTEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (symbol),
  INDEX idx_eodhd_fund_fetched_at (fetched_at)
);

-- Reinvestment system (dividends accrue into a cash pool and are reinvested on a schedule)

CREATE TABLE IF NOT EXISTS dividend_accruals (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  symbol VARCHAR(16) NOT NULL,
  amount DECIMAL(18,6) NOT NULL,
  accrual_date DATE NOT NULL,
  frequency VARCHAR(16) NOT NULL,
  consumed_execution_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_accruals_user_date (user_id, accrual_date),
  INDEX idx_accruals_user_symbol (user_id, symbol),
  INDEX idx_accruals_user_consumed (user_id, consumed_execution_id)
);

CREATE TABLE IF NOT EXISTS dividend_cash_pool (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  available_balance DECIMAL(18,6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_cash_pool_user (user_id)
);

CREATE TABLE IF NOT EXISTS reinvestment_rules (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  enabled TINYINT(1) NOT NULL,
  source_scope VARCHAR(16) NOT NULL,
  destination_type VARCHAR(32) NOT NULL,
  destination_assets JSON NOT NULL,
  schedule_mode VARCHAR(24) NOT NULL DEFAULT 'WEEK_OF_MONTH',
  frequency VARCHAR(16) NOT NULL,
  week_destinations JSON NULL,
  minimum_amount DECIMAL(18,6) NOT NULL,
  fractional_shares_allowed TINYINT(1) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rules_user_updated (user_id, updated_at)
);

CREATE TABLE IF NOT EXISTS reinvestment_executions (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  rule_id CHAR(36) NOT NULL,
  execution_date DATE NOT NULL,
  week_index TINYINT NULL,
  total_amount DECIMAL(18,6) NOT NULL,
  execution_details JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_exec_user_date (user_id, execution_date),
  INDEX idx_exec_user_week (user_id, week_index, execution_date),
  INDEX idx_exec_rule_date (rule_id, execution_date)
);

-- Cached stock data (filled on-demand by /api/stocks/:symbol)

CREATE TABLE IF NOT EXISTS stock_realtime (
  symbol VARCHAR(32) NOT NULL,
  payload LONGTEXT NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (symbol),
  INDEX idx_stock_realtime_fetched_at (fetched_at)
);

CREATE TABLE IF NOT EXISTS stock_eod (
  symbol VARCHAR(32) NOT NULL,
  date DATE NOT NULL,
  open DECIMAL(18,6) NOT NULL,
  high DECIMAL(18,6) NOT NULL,
  low DECIMAL(18,6) NOT NULL,
  close DECIMAL(18,6) NOT NULL,
  adjusted_close DECIMAL(18,6) NULL,
  volume BIGINT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (symbol, date),
  INDEX idx_stock_eod_symbol_date (symbol, date)
);

CREATE TABLE IF NOT EXISTS stock_dividends (
  symbol VARCHAR(32) NOT NULL,
  date DATE NOT NULL,
  value DECIMAL(18,6) NOT NULL,
  currency VARCHAR(8) NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (symbol, date),
  INDEX idx_stock_div_symbol_date (symbol, date)
);

CREATE TABLE IF NOT EXISTS portfolio_summary (
  user_id CHAR(36) NOT NULL,
  cash_balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
);
