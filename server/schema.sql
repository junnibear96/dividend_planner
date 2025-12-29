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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_holdings_user_created_at (user_id, created_at),
  INDEX idx_holdings_created_at (created_at)
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
