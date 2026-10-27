# Counts rows with an in-memory SQLite database.
import sqlite3


def count_rows(rows):
    db = sqlite3.connect(":memory:")
    db.execute("create table t (x)")
    db.executemany("insert into t values (?)", [(r,) for r in rows])
    return db.execute("select count(*) from t").fetchone()[0]
