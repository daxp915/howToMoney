#!/bin/sh
# Daily encrypted database backup. Runs forever inside the `backup` service
# (docker-compose.prod.yml); see backup/README.md for restoring.
#
# Encrypted to a public certificate only: the NAS can write a backup but never
# read one, so a copied backup folder is useless without the private key,
# which lives off the NAS. A dump is checked with `pg_restore -l` before it is
# encrypted, so a truncated dump fails loudly instead of being kept.
#
# openssl CMS, not gpg: DSM 6's kernel has no getrandom(), and every gpg build
# (Alpine and Debian alike) dies with "getentropy is not supported" rather
# than falling back to /dev/urandom. OpenSSL falls back.
#
# "Once a day" means "no file for today yet", checked hourly. A restart, a
# rebuild or a NAS that was off at 3am therefore never skips a day, and
# never takes two.
set -eu

OUT=/backups
CERT=/backup/howtomoney-backup.crt
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
export PGPASSWORD="$POSTGRES_PASSWORD"

take() {
	day=$(date -u +%F)
	final="$OUT/howtomoney-$day.dump.cms"
	[ -e "$final" ] && return 0

	# Every step checks itself: `set -e` is off inside a function called with
	# `||`, so a failed pg_dump would otherwise be encrypted and kept.
	tmp=$(mktemp /tmp/dump.XXXXXX) || return 1
	if ! { pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$tmp" &&
		pg_restore -l "$tmp" > /dev/null &&
		openssl cms -encrypt -binary -aes-256-gcm -recip "$CERT" \
			-keyopt rsa_padding_mode:oaep -outform DER \
			-in "$tmp" -out "$final.part"; }; then
		rm -f "$tmp" "$final.part"
		return 1
	fi
	rm -f "$tmp"
	mv "$final.part" "$final" || return 1
	echo "[backup] wrote $final ($(wc -c < "$final") bytes)"

	find "$OUT" -name 'howtomoney-*.dump.cms' -mtime +"$KEEP_DAYS" -print -delete \
		| sed 's/^/[backup] expired /'
}

echo "[backup] starting, keeping $KEEP_DAYS days"
while :; do
	take || echo "[backup] FAILED; retrying in an hour" >&2
	sleep 3600
done
