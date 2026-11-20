#!/bin/sh
set -eu

destination=${1:?Укажите новый каталог для резервной копии}
umask 077
mkdir -p "$(dirname "$destination")"
mkdir "$destination"

restart_api() {
    docker compose start api >/dev/null
}
trap restart_api EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose stop api
docker compose exec -T postgres sh -c \
    'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$destination/db.dump"
docker compose run --rm --no-deps -T --entrypoint tar api \
    -C /data/media -czf - . > "$destination/media.tar.gz"
(cd "$destination" && shasum -a 256 db.dump media.tar.gz > SHA256SUMS)
printf 'Копия сохранена в %s\n' "$destination"
