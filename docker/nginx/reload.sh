#!/bin/bash
# Nginx config reload script for CC-on-Bedrock
# Polls S3 every 30s for updated config, validates, and reloads

set -e

CONFIG_BUCKET="${CONFIG_BUCKET:-}"
CONFIG_KEY="${CONFIG_KEY:-nginx/nginx.conf}"
LOCAL_CONFIG="/etc/nginx/nginx.conf"
TEMP_CONFIG="/tmp/nginx.conf.new"
RELOAD_INTERVAL="${RELOAD_INTERVAL:-30}"
LAST_ETAG=""

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Generate self-signed cert if not exists (for initial startup)
setup_ssl() {
    SSL_DIR="/etc/nginx/ssl"
    mkdir -p "$SSL_DIR"

    if [ ! -f "$SSL_DIR/cert.pem" ] || [ ! -f "$SSL_DIR/key.pem" ]; then
        log "Generating self-signed SSL certificate..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$SSL_DIR/key.pem" \
            -out "$SSL_DIR/cert.pem" \
            -subj "/CN=*.dev.cc-on-bedrock.local/O=CC-on-Bedrock/C=KR" \
            2>/dev/null
        log "SSL certificate generated"
    fi
}

# Download config from S3 if changed
download_config() {
    if [ -z "$CONFIG_BUCKET" ]; then
        log "CONFIG_BUCKET not set, skipping S3 sync"
        return 1
    fi

    # Get current ETag
    CURRENT_ETAG=$(aws s3api head-object \
        --bucket "$CONFIG_BUCKET" \
        --key "$CONFIG_KEY" \
        --query 'ETag' \
        --output text 2>/dev/null || echo "")

    if [ -z "$CURRENT_ETAG" ]; then
        log "Config not found in S3: s3://$CONFIG_BUCKET/$CONFIG_KEY"
        return 1
    fi

    # Check if config changed
    if [ "$CURRENT_ETAG" = "$LAST_ETAG" ]; then
        return 1
    fi

    log "Config changed (ETag: $CURRENT_ETAG), downloading..."

    if aws s3 cp "s3://$CONFIG_BUCKET/$CONFIG_KEY" "$TEMP_CONFIG" --quiet; then
        LAST_ETAG="$CURRENT_ETAG"
        return 0
    else
        log "Failed to download config from S3"
        return 1
    fi
}

# Validate and reload nginx config
reload_nginx() {
    if [ ! -f "$TEMP_CONFIG" ]; then
        return 1
    fi

    log "Validating new config..."

    if nginx -t -c "$TEMP_CONFIG" 2>&1; then
        log "Config valid, applying..."
        cp "$TEMP_CONFIG" "$LOCAL_CONFIG"

        if nginx -s reload 2>&1; then
            log "Nginx reloaded successfully"
            rm -f "$TEMP_CONFIG"
            return 0
        else
            log "Failed to reload nginx"
            return 1
        fi
    else
        log "Config validation failed, keeping current config"
        rm -f "$TEMP_CONFIG"
        return 1
    fi
}

# Main
main() {
    log "Starting nginx config reload daemon"
    log "CONFIG_BUCKET: ${CONFIG_BUCKET:-not set}"
    log "CONFIG_KEY: $CONFIG_KEY"
    log "RELOAD_INTERVAL: ${RELOAD_INTERVAL}s"

    # Setup SSL certificates
    setup_ssl

    # Start nginx in background
    log "Starting nginx..."
    nginx -g 'daemon off;' &
    NGINX_PID=$!

    # Give nginx time to start
    sleep 2

    if ! kill -0 $NGINX_PID 2>/dev/null; then
        log "ERROR: Nginx failed to start"
        exit 1
    fi

    log "Nginx started (PID: $NGINX_PID)"

    # Config reload loop
    while true; do
        if download_config; then
            reload_nginx
        fi
        sleep "$RELOAD_INTERVAL"
    done
}

# Handle signals
trap 'log "Shutting down..."; nginx -s quit; exit 0' SIGTERM SIGINT

main
