#!/bin/bash
set -euo pipefail

echo "=== CC-on-Bedrock Devenv: Common Setup ==="

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
else
  echo "ERROR: Cannot detect OS"
  exit 1
fi

echo "Detected OS: $OS_ID"

# --- Package Manager Setup ---
install_packages() {
  case "$OS_ID" in
    ubuntu)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y --no-install-recommends \
        curl wget git jq unzip tar gzip ca-certificates \
        build-essential python3 python3-pip python3-venv \
        openssh-client sudo locales
      # Set locale
      locale-gen en_US.UTF-8
      ;;
    amzn)
      dnf update -y -q
      dnf install -y -q \
        curl wget git jq unzip tar gzip ca-certificates \
        gcc gcc-c++ make python3 python3-pip \
        openssh-clients sudo
      ;;
    *)
      echo "ERROR: Unsupported OS: $OS_ID"
      exit 1
      ;;
  esac
}

# --- Create coder user ---
create_user() {
  if ! id coder &>/dev/null; then
    useradd -m -s /bin/bash -d /home/coder coder
    echo "coder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/coder
    chmod 0440 /etc/sudoers.d/coder
  fi
}

# --- Node.js 20 via fnm ---
install_nodejs() {
  echo "Installing Node.js 20 via fnm..."
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /usr/local/bin --skip-shell
  export PATH="/usr/local/bin:$PATH"
  eval "$(fnm env)"
  fnm install 20
  fnm default 20

  # Make node/npm globally available
  NODE_PATH=$(fnm exec --using=20 which node)
  NODE_DIR=$(dirname "$NODE_PATH")
  ln -sf "$NODE_DIR/node" /usr/local/bin/node
  ln -sf "$NODE_DIR/npm" /usr/local/bin/npm
  ln -sf "$NODE_DIR/npx" /usr/local/bin/npx

  echo "Node.js $(node --version) installed"
}

# --- Python uv ---
install_uv() {
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | env CARGO_HOME=/usr/local sh
  # Ensure uv is on PATH for all users
  ln -sf /root/.local/bin/uv /usr/local/bin/uv 2>/dev/null || true
  echo "uv installed"
}

# --- AWS CLI v2 (ARM64) ---
install_awscli() {
  echo "Installing AWS CLI v2..."
  ARCH=$(uname -m)
  if [ "$ARCH" = "aarch64" ]; then
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip
  else
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  fi
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
  echo "AWS CLI $(aws --version) installed"
}

# --- code-server ---
install_codeserver() {
  echo "Installing code-server..."
  curl -fsSL https://code-server.dev/install.sh | sh
  echo "code-server $(code-server --version | head -1) installed"
}

# --- Docker CLI ---
install_docker_cli() {
  echo "Installing Docker CLI..."
  case "$OS_ID" in
    ubuntu)
      apt-get update -qq && apt-get install -y --no-install-recommends docker.io
      # docker.io from Ubuntu default repos provides Docker CLI
      ;;
    amzn)
      dnf install -y -q docker
      ;;
  esac
  echo "Docker CLI installed"
}

# --- pip packages ---
install_pip_packages() {
  echo "Installing pip packages..."
  pip3 install --break-system-packages boto3 click 2>/dev/null \
    || pip3 install boto3 click
  # Note: MCP servers are installed via uvx at runtime, not pip
}

# --- Cleanup ---
cleanup() {
  case "$OS_ID" in
    ubuntu)
      apt-get clean
      rm -rf /var/lib/apt/lists/*
      ;;
    amzn)
      dnf clean all
      ;;
  esac
  rm -rf /tmp/*
}

# --- Execute ---
install_packages
create_user
install_nodejs
install_uv
install_awscli
install_codeserver
install_docker_cli
install_pip_packages
cleanup

echo "=== Common setup complete ==="
