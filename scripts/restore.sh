#!/bin/sh
set -eu

source=${1:?Укажите каталог с резервной копией}
: "${COMPOSE_PROJECT_NAME:?Укажите имя отдельного проекта Compose}"
(cd "$source" && shasum -a 256 -c SHA256SUMS)

docker compose up -d --wait postgres
objects=$(docker compose exec -T postgres sh -c \
    'psql -XAt -U "$POSTGRES_USER" "$POSTGRES_DB" -c "SELECT count(*) FROM pg_tables WHERE schemaname = current_schema()"')
if [ "$objects" != "0" ]; then
    printf '%s\n' 'Восстановление требует пустой базы данных.' >&2
    exit 1
fi

docker compose run --rm --no-deps -T --entrypoint sh api -c '
    set -eu
    if [ -n "$(ls -A /data/media)" ]; then
        echo "Том изображений должен быть пустым." >&2
        exit 1
    fi
    tar -C /data/media -xzf -
' < "$source/media.tar.gz"
docker compose exec -T postgres sh -c \
    'pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    < "$source/db.dump"
SEED_DEMO=false docker compose up -d --wait
