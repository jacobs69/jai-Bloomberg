import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dataDir = process.env.DATA_DIR ?? join(root, "data");
try {
  mkdirSync(dataDir, { recursive: true });
} catch {
  // Ignore on read-only or ephemeral filesystems
}

type PortfolioRow = { id: number; name: string; created_at: string };
type TransactionRow = {
  id: number;
  portfolio_id: number;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  executed_at: string;
};

// MOCKED — in-memory SQLite replacement (better-sqlite3 native addon stripped)
const portfolios: PortfolioRow[] = [
  { id: 1, name: "Main", created_at: new Date().toISOString() },
];
const transactions: TransactionRow[] = [];
let nextPortfolioId = 2;
let nextTxId = 1;

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

export const db = {
  pragma(_pragma: string) {
    return null;
  },
  exec(_sql: string) {
    return this;
  },
  close() {
    // no-op for in-memory store
  },
  prepare(sql: string) {
    const norm = normalizeSql(sql);

    return {
      get(...params: unknown[]) {
        if (norm.startsWith("select id from portfolios limit 1")) {
          return portfolios[0] ? { id: portfolios[0].id } : undefined;
        }
        if (norm.startsWith("select * from portfolios where id = ?")) {
          const id = Number(params[0]);
          return portfolios.find((p) => p.id === id);
        }
        return undefined;
      },

      all(...params: unknown[]) {
        if (norm.startsWith("select * from portfolios order by id")) {
          return [...portfolios].sort((a, b) => a.id - b.id);
        }
        if (norm.startsWith("select * from transactions where portfolio_id = ? order by executed_at desc")) {
          const pid = Number(params[0]);
          return transactions
            .filter((t) => t.portfolio_id === pid)
            .sort((a, b) => b.executed_at.localeCompare(a.executed_at) || b.id - a.id);
        }
        if (norm.startsWith("select * from transactions where portfolio_id = ? order by executed_at, id")) {
          const pid = Number(params[0]);
          return transactions
            .filter((t) => t.portfolio_id === pid)
            .sort((a, b) => a.executed_at.localeCompare(b.executed_at) || a.id - b.id);
        }
        return [];
      },

      run(...params: unknown[]) {
        if (norm.startsWith("insert into portfolios (name) values (?)")) {
          const name = String(params[0]);
          if (portfolios.some((p) => p.name === name)) {
            throw new Error("UNIQUE constraint failed: portfolios.name");
          }
          const row: PortfolioRow = {
            id: nextPortfolioId++,
            name,
            created_at: new Date().toISOString(),
          };
          portfolios.push(row);
          return { changes: 1, lastInsertRowid: row.id };
        }

        if (norm.startsWith("delete from transactions where portfolio_id = ?")) {
          const pid = Number(params[0]);
          let changes = 0;
          for (let i = transactions.length - 1; i >= 0; i--) {
            if (transactions[i].portfolio_id === pid) {
              transactions.splice(i, 1);
              changes++;
            }
          }
          return { changes, lastInsertRowid: 0 };
        }

        if (norm.startsWith("delete from portfolios where id = ?")) {
          const id = Number(params[0]);
          const idx = portfolios.findIndex((p) => p.id === id);
          if (idx >= 0) {
            portfolios.splice(idx, 1);
            return { changes: 1, lastInsertRowid: 0 };
          }
          return { changes: 0, lastInsertRowid: 0 };
        }

        if (norm.startsWith("insert into transactions")) {
          const pid = Number(params[0]);
          if (!portfolios.some((p) => p.id === pid)) {
            throw new Error("FOREIGN KEY constraint failed");
          }
          const row: TransactionRow = {
            id: nextTxId++,
            portfolio_id: pid,
            symbol: String(params[1]),
            side: String(params[2]) as "BUY" | "SELL",
            quantity: Number(params[3]),
            price: Number(params[4]),
            executed_at: String(params[5]),
          };
          transactions.push(row);
          return { changes: 1, lastInsertRowid: row.id };
        }

        if (norm.startsWith("delete from transactions where id = ? and portfolio_id = ?")) {
          const id = Number(params[0]);
          const pid = Number(params[1]);
          const idx = transactions.findIndex((t) => t.id === id && t.portfolio_id === pid);
          if (idx >= 0) {
            transactions.splice(idx, 1);
            return { changes: 1, lastInsertRowid: 0 };
          }
          return { changes: 0, lastInsertRowid: 0 };
        }

        return { changes: 0, lastInsertRowid: 0 };
      },
    };
  },
};
