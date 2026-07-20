# Community container reference

The repository includes a local reference container for trying the existing
Zeus viewer without an IBM i system or a model. It is an example for local
development, not a production certification or hardened enterprise
deployment.

## Defaults and boundaries

- The image uses the pinned `node:22.18.0-bookworm-slim` release and runs as
  the non-root `node` user.
- Compose enables a read-only root filesystem, drops Linux capabilities,
  disallows privilege escalation, and exposes the viewer only on
  `127.0.0.1:4782`. Inside the container, Zeus listens on the container
  interface (`0.0.0.0`); Docker's host publishing remains explicitly bound to
  host loopback.
- Only `/data/artifacts` is writable. `/tmp` is an ephemeral, bounded tmpfs.
- No model is downloaded and no IBM i or Db2 connection is attempted by the
  default help/demo path.
- No credential is included. Operator-supplied values must come from the
  environment or an external secret mechanism; do not place them in Compose,
  source control, logs, or generated artifacts.
- The image does not create a public ingress, host-network access, host mounts,
  or cluster permissions.

## Zeus-only profile

Build and start the local viewer with existing artifacts:

```bash
docker compose --profile zeus up --build
```

Open `http://127.0.0.1:4782` locally. The named `zeus-artifacts` volume is the
only persistent writable location. The image's default command is `zeus
--help`, which is useful for a build/package smoke test without IBM i or model
access. The default reachability check uses the existing read-only
`GET /api/health` route; it needs no provider, IBM i, or Db2 access.

## Local-provider profile

The profile documents operator-supplied provider metadata without probing,
downloading, or falling back to a model automatically:

```bash
ZEUS_PROVIDER_ENDPOINT=http://127.0.0.1:11434 \
ZEUS_PROVIDER_MODEL=operator-selected-model \
  docker compose --profile local-provider up --build
```

These are placeholders for an operator-approved private endpoint and model.
They are not credentials and are not embedded in the image. Provider access
still requires the application's explicit provider configuration and policy;
starting this reference profile alone does not authorize remote access.

## Validation

Run the repository's local checks first:

```bash
npm run test:deployment:community
```

If Docker is installed, an operator may additionally run `docker compose
config` and a local build. CI/static tests must not claim a Docker build when
Docker is unavailable. This reference intentionally makes no claim of
Kubernetes, VPC, registry, backup, retention, certification, or production
readiness; those operational concerns belong to the private Enterprise module.
