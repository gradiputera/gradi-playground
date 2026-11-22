# One image for Vercel (Container runtime), Docker Compose and Kubernetes (ADR 0003).
# FrankenPHP serves Laravel from a single process (Caddy with PHP built in).

FROM composer:2.11.2 AS composer

FROM dunglas/frankenphp:1.14.0-php8.4.28-trixie AS build
COPY --from=composer /usr/bin/composer /usr/bin/composer
RUN install-php-extensions zip
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --no-progress --no-scripts --no-autoloader --prefer-dist
COPY . .
RUN composer dump-autoload --no-dev --optimize --classmap-authoritative --no-scripts

FROM dunglas/frankenphp:1.14.0-php8.4.28-trixie
RUN install-php-extensions pdo_pgsql opcache \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    # A non-root user binds 8080, so FrankenPHP needs no extra capability.
    && setcap -r /usr/local/bin/frankenphp \
    && mkdir -p /data/caddy /config/caddy \
    && chown -R app:app /data/caddy /config/caddy
WORKDIR /app
COPY --from=build --chown=app:app /app /app
COPY docker/Caddyfile /etc/frankenphp/Caddyfile
COPY docker/php.ini /usr/local/etc/php/conf.d/zz-account-service.ini
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/account-service
# A non-root user cannot bind port 80, so the image listens on 8080. Set PORT=8080 on Vercel too.
ENV PORT=8080 APP_ENV=production APP_DEBUG=false LOG_LEVEL=info
EXPOSE 8080
USER app
ENTRYPOINT ["/usr/local/bin/account-service"]
