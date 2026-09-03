#!/bin/sh
set -eu

: "${SFTP_USER:=e2e}"
: "${SFTP_PASSWORD:=e2e-password-only}"

mkdir -p /run/sshd /home/${SFTP_USER}
if ! id "${SFTP_USER}" >/dev/null 2>&1; then
  adduser -D -h "/home/${SFTP_USER}" "${SFTP_USER}"
fi
echo "${SFTP_USER}:${SFTP_PASSWORD}" | chpasswd

chown root:root "/home/${SFTP_USER}"
chmod 0755 "/home/${SFTP_USER}"

ssh-keygen -A >/dev/null 2>&1
cat >/etc/ssh/sshd_config.d/e2e.conf <<EOF
Port 22
ListenAddress 0.0.0.0
PasswordAuthentication yes
PermitRootLogin no
AllowUsers ${SFTP_USER}
ChrootDirectory /home/%u
ForceCommand internal-sftp -d /
AllowTcpForwarding no
X11Forwarding no
PermitTunnel no
EOF

exec /usr/sbin/sshd -D -e
