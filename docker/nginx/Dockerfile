# Nginx dynamic router for CC-on-Bedrock Enterprise
# Handles Host-header based routing to user containers
# Replaces ALB listener rules (100 rule limit) with unlimited routing

FROM nginx:1.27-alpine

# Install AWS CLI and OpenSSL for S3 config sync and SSL cert generation
RUN apk add --no-cache \
    aws-cli \
    openssl \
    curl \
    bash

# Create directories
RUN mkdir -p /etc/nginx/ssl /var/log/nginx

# Copy config template and reload script
COPY nginx.conf.template /etc/nginx/nginx.conf
COPY reload.sh /opt/reload.sh

# Make reload script executable
RUN chmod +x /opt/reload.sh

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:8080/health || exit 1

# Expose ports: 443 (HTTPS traffic), 8080 (health check)
EXPOSE 443 8080

# Run reload script which starts nginx and polls S3 for config updates
CMD ["/opt/reload.sh"]
