import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlDatabase, SqlStatement } from '../sync';

/** Just enough of D1 on top of node:sqlite to run the sync handler in tests. */
export function sqliteD1(): SqlDatabase {
  const db = new DatabaseSync(':memory:');
  const statement = (sql: string, params: unknown[] = []): SqlStatement & { exec(): { results: unknown[] } } => {
    const args = params.map((v) => (typeof v === 'boolean' ? Number(v) : v)) as SQLInputValue[];
    const exec = () => {
      const st = db.prepare(sql);
      return { results: st.columns().length > 0 ? st.all(...args) : (st.run(...args), []) };
    };
    return {
      bind: (...values) => statement(sql, values),
      first: async <T,>() => (exec().results[0] as T | undefined) ?? null,
      all: async <T,>() => exec() as { results: T[] },
      run: async () => exec(),
      exec,
    };
  };
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => (s as ReturnType<typeof statement>).exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
