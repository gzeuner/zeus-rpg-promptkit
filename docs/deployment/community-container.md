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

## Synthetic secret-injection example

The following is a copyable **synthetic-only** example of supplying an existing
runtime secret from outside the image. The value is intentionally fake and is
not used by the local help/health smoke path; it only demonstrates the
operator-to-container boundary for an existing environment-backed setting.

```bash
# Synthetic placeholder only; never use a real credential in this file.
cat > .env.zeus.local <<'EOF'
ZEUS_FETCH_PASSWORD=synthetic-placeholder-only
EOF

# --env-file reads the local operator file; --env passes that variable into
# this one-shot container. The image and repository remain unchanged.
docker compose --env-file .env.zeus.local --profile zeus run --rm \
  --env ZEUS_FETCH_PASSWORD zeus --help

# Remove the local-only file after the smoke.
rm -f .env.zeus.local
```

Keep `.env.zeus.local` outside source control and replace the synthetic value
only in the operator's private environment. Do not add it to the image,
Compose YAML, logs, artifacts, or this repository. This example does not
configure a provider, authorize remote access, or claim Kubernetes/Enterprise
secret management.

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
