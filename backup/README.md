# Database backups

The `backup` service in `docker-compose.prod.yml` writes one encrypted Postgres dump a day to `./backups/howtomoney-YYYY-MM-DD.dump.cms`. It deletes dumps older than 30 days; change that with `BACKUP_KEEP_DAYS`.

- **No missed days.** It checks every hour whether today's file exists, so a restart or a server that was off overnight still gets its daily backup.
- **No silent truncation.** Each dump must pass `pg_restore -l` before it's encrypted, so a cut-off dump fails loudly instead of being kept.
- **Logs.** `docker compose logs backup` shows every write and every failure.

## Encryption model

Dumps are encrypted with openssl CMS (AES-256-GCM, with the key wrapped by RSA-OAEP) to a **public certificate**. The server only ever holds that certificate. It can write backups but **cannot read them**, so a copied backup folder is useless without the private key, which you keep somewhere else.

**Why not gpg?** Some NAS kernels (for example Synology DSM 6) don't have `getrandom()`, and gpg exits instead of falling back to `/dev/urandom`. OpenSSL falls back.

### Create your key pair (once)

Run this on a machine that is **not** the server:

```bash
mkdir -p ~/.howtomoney-backup && cd ~/.howtomoney-backup
openssl req -x509 -newkey rsa:4096 -nodes -days 3650 -subj "/CN=howtomoney-backup" \
  -keyout howtomoney-backup-PRIVATE.key -out howtomoney-backup.crt
```

1. Copy `howtomoney-backup.crt` into this `backup/` folder before you build. It is git-ignored.
2. Keep `howtomoney-backup-PRIVATE.key` off the server, and save a copy in a password manager. **Without it, every backup is unreadable.**

## Restoring

1. **Decrypt the dump** on the machine that holds the private key:

   ```bash
   openssl cms -decrypt -binary -inform DER -in howtomoney-YYYY-MM-DD.dump.cms \
     -inkey ~/.howtomoney-backup/howtomoney-backup-PRIVATE.key -out howtomoney.dump
   ```

2. **Copy `howtomoney.dump` into the server's `backups/` folder.**

3. **Restore it.** This **replaces** the live data, so stop the web and worker services first so nothing writes during the restore:

   ```bash
   C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
   $C stop web worker
   $C exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backups/howtomoney.dump
   $C start web worker
   rm backups/howtomoney.dump
   ```

4. **Delete the decrypted `.dump`** everywhere it exists. It is the plaintext ledger.

**To practise a restore without touching production:** create a scratch database inside the `db` container with `createdb`, restore into it with `-d`, then drop it.
