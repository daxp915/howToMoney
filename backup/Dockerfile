# Same major version as the `db` service, so pg_dump matches the server.
FROM postgres:16-alpine
RUN apk add --no-cache openssl
COPY howtomoney-backup.crt backup.sh /backup/
ENTRYPOINT ["sh", "/backup/backup.sh"]
