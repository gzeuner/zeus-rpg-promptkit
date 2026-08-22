FROM alpine:3.20

RUN apk add --no-cache openssh-server

COPY entrypoint.sh /usr/local/bin/e2e-sftp-entrypoint
RUN chmod 0755 /usr/local/bin/e2e-sftp-entrypoint

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/e2e-sftp-entrypoint"]
