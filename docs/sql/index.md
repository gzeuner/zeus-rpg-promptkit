---
Title: SQL Discovery Assets
Description: SQL-Skripte fuer reproduzierbare IBM i und DB2 Discovery-Abfragen im Zeus-Dokumentationskontext.
Last Updated: 2026-05-17
---

# SQL Discovery Assets

Diese Sektion enthaelt kuratierte SQL-Skripte fuer System-, Schema- und Objekt-Discovery.

## Assets

- [`system-environment-discovery.sql`](system-environment-discovery.sql)

## Usage Notes

- Queries sind als read-only Discovery konzipiert.
- Placeholder-Werte vor Nutzung in produktionsnahen Umgebungen ersetzen.
- Ergebnisse als Evidence fuer `query-table`, `query-sql`, `inspect-object`, `resolve-object` und Review-Workflows nutzen.
- Siehe auch: [`../quickstart/onboarding-new-ibm-i.md`](../quickstart/onboarding-new-ibm-i.md) für den vollständigen Onboarding-Prozess (Connect, Source-Suche, Objekte, Meta-Daten, Daten).
