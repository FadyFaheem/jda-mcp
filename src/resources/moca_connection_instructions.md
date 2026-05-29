---
name: 'MOCA Connection Instructions'
description: 'How to discover, create, save and reuse MOCA connections'
uriTemplate: 'resource://moca_connection_instructions'
---
# Connecting to MOCA

## Connection types
- **http** - MOCA XML over HTTP/HTTPS. Provide `url`, e.g. `http://host:4600/service`. For HTTPS
  with a self-signed cert, set `trustSSLCertificate: true`.
- **tcp** - the legacy MOCA wire protocol (V101/V103). Provide `host` and `port`.

## Discovering servers on this machine
`discover_connections` finds MOCA servers already configured on this machine:
- Windows registry: `HKLM\SOFTWARE\Mchugh\Client\<env>\MOCA Servers\<server>` (`HostName`, `PortNumber`).
- RedPrairie config: `%APPDATA%`/`%PROGRAMDATA%\RedPrairie\DLXClient\DLXClientConfig.xml`
  (`/ClientConfig/MOCAServers/MOCAServer`).

Each result has a `source` tag. Pass `save: true` to persist them as profiles, or use
`import_connections`.

## Creating and reusing a connection
```
create_connection { name: "My MOCA (TCP)", type: "tcp", host: "myhost", port: 4500, username: "me", password: "..." }
connect { connectionId: "<id from create>" }
```
Or connect inline and save in one step:
```
connect { type: "http", url: "http://host:4600/service", username: "me", password: "...", save: true }
```

## Notes
- Passwords are encrypted at rest (Windows DPAPI, CurrentUser scope) and never returned by any tool.
- `test_connection` verifies credentials without keeping a session open.
- Only one active session at a time; `connect` replaces the previous one.
- `environmentVariables` are sent with every request (e.g. `LOCALE_ID`).
