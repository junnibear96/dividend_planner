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
  annual_dividend_per_share DECIMAL(18,6) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_holdings_user_created_at (user_id, created_at),
  INDEX idx_holdings_created_at (created_at)
);
