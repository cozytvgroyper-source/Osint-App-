# SignalDesk

A local-first, user-friendly client for MCP servers and Open OSINT workflows.

## Run

On this Mac, double-click **Start SignalDesk.command**. When finished, double-click
**Stop SignalDesk.command**. All three services bind to localhost and are available
only on this computer.

For a terminal launch of the interface only:

```bash
npm start
```

Open <http://127.0.0.1:4173>. No package installation is required.

## Connect Open OSINT

The local launcher starts the adjacent `osint-mcp` data and MCP services automatically.
SignalDesk connects to:

```text
http://127.0.0.1:8892/mcp
```

SignalDesk supports MCP Streamable HTTP, tool discovery, JSON-schema-assisted arguments, tool execution, local investigation history, and evidence export. Bearer tokens remain in browser memory and are not persisted.

## Security notes

- The UI is served only on `127.0.0.1` by default.
- Embedded URL credentials and common cloud metadata endpoints are blocked.
- Remote endpoints receive only requests explicitly initiated through the app.
- Review source terms and legal constraints before collecting or retaining OSINT data.
