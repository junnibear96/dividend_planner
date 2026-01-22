
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

async function reset() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        namedPlaceholders: true,
    });

    try {
        // Tables to reset to use UUIDs
        const tables = [
            'reinvestment_executions', // child of rules
            'dividend_accruals',
            'reinvestment_rules',
            'holdings',
            'dividend_cash_pool',
            'watchlist_items'
        ];

        for (const t of tables) {
            console.log(`Dropping ${t}...`);
            await pool.query(`DROP TABLE IF EXISTS ${t}`);
        }

        console.log('Tables dropped. Recreating from new schema (manually here to ensure order/correctness)...');

        // holdings
        await pool.query(`
        CREATE TABLE holdings (
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
        )
      `);
        console.log('Created holdings');

        // watchlist_items
        await pool.query(`
        CREATE TABLE watchlist_items (
          id CHAR(36) NOT NULL,
          user_id CHAR(36) NOT NULL,
          symbol VARCHAR(32) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_watchlist_user_symbol (user_id, symbol),
          INDEX idx_watchlist_user_created_at (user_id, created_at)
        )
      `);
        console.log('Created watchlist_items');

        // dividend_accruals
        await pool.query(`
        CREATE TABLE dividend_accruals (
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
        )
      `);
        console.log('Created dividend_accruals');

        // dividend_cash_pool
        await pool.query(`
        CREATE TABLE dividend_cash_pool (
          id CHAR(36) NOT NULL,
          user_id CHAR(36) NOT NULL,
          available_balance DECIMAL(18,6) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uniq_cash_pool_user (user_id)
        )
      `);
        console.log('Created dividend_cash_pool');

        // reinvestment_rules
        await pool.query(`
        CREATE TABLE reinvestment_rules (
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
        )
      `);
        console.log('Created reinvestment_rules');

        // reinvestment_executions
        await pool.query(`
        CREATE TABLE reinvestment_executions (
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
        )
      `);
        console.log('Created reinvestment_executions');

        console.log('All Reinvestment tables reset to UUID schema.');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

reset();
