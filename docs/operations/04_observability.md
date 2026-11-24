# Observability

Server observability is local only: pretty stdout logs (not persisted locally, except SSH-managed
launches at `~/.t3/ssh-launch/<state>/server.log`) and an event-loop stall file. Nothing is exported
from the server: there are no trace files, OTLP exporters, metrics or logs pipelines.

## Event-loop stalls

Stalls (>2 s) append to `event-loop-stalls.ndjson` in the server's logs directory. SQLite spans carry
`db.connection` (`writer`/`reader`) and `db.lock_wait_ms` (queue wait off the event loop—subtract it
before blaming query speed).

## Heap snapshots

On macOS and Linux (not Windows), send `SIGUSR2` to the server PID from `server-runtime.json` (in the server's state dir beside `logs/`) to write `<logsDir>/server-<pid>-<timestamp>.heapsnapshot` for Chrome DevTools Memory tab:

```sh
pid="$(jq .pid "${T3CODE_HOME:-$HOME/.t3}/userdata/server-runtime.json")"
ps -p "$pid" -o command=   # verify it is the T3 server—never signal desktop or launcher
kill -USR2 "$pid"
```

- Writing pauses the server (up to a minute+ on large heaps) and needs roughly as much free RAM as the heap—send once, and avoid on a swapping host.
- Snapshots contain tokens, secrets, and thread content. Never share them publicly, and delete them manually when finished.
