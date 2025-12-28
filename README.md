# BAB Proxy (Docker)

Self-hosted CORS proxy with full content extraction for [Blogs Are Back](https://blogsareback.com).

## Quick Start

### Using Docker Run

```bash
docker run -d \
  -p 3000:3000 \
  -e BAB_API_KEY=your-secret-key \
  --name bab-proxy \
  blogsareback/bab-proxy
```

### Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/blogsareback/proxy-docker.git
cd proxy-docker

# Set your API key (optional)
export BAB_API_KEY=your-secret-key

# Start the proxy
docker compose up -d
```

### Building Locally

```bash
# Build the image
docker build -t bab-proxy .

# Run the container
docker run -d -p 3000:3000 -e BAB_API_KEY=your-secret-key bab-proxy
```

## Features

- **Unlimited requests** - No rate limits
- **Feed fetching** - Fetch RSS/Atom feeds with CORS bypass
- **Content extraction** - Extract article content using Mozilla Readability
- **Feed discovery** - Discover feeds from any blog URL
- **Full control** - Self-hosted, configure everything

## Endpoints

| Endpoint    | Method | Description                           |
| ----------- | ------ | ------------------------------------- |
| `/health`   | GET    | Health check and capability detection |
| `/fetch`    | POST   | Fetch RSS/Atom feed content           |
| `/parse`    | POST   | Extract article content from URL      |
| `/discover` | POST   | Discover feeds and blog metadata      |

### Example: Health Check

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "ok": true,
  "version": "2.0.0",
  "provider": "node-docker",
  "capabilities": ["fetch", "parse", "discover"]
}
```

### Example: Fetch Feed

```bash
curl -X POST http://localhost:3000/fetch \
  -H "Content-Type: application/json" \
  -d '{"url": "https://overreacted.io/rss.xml"}'
```

### Example: Parse Article

```bash
curl -X POST http://localhost:3000/parse \
  -H "Content-Type: application/json" \
  -d '{"url": "https://overreacted.io/a-chain-reaction/"}'
```

### Example: Discover Feeds

```bash
curl -X POST http://localhost:3000/discover \
  -H "Content-Type: application/json" \
  -d '{"url": "overreacted.io"}'
```

## Configuration

### Environment Variables

| Variable               | Default | Description                             |
| ---------------------- | ------- | --------------------------------------- |
| `PORT`                 | `3000`  | Server port                             |
| `BAB_API_KEY`          | -       | Require API key for all requests        |
| `ALLOWED_ORIGINS`      | `*`     | CORS allowed origins (comma-separated)  |
| `MAX_RESPONSE_SIZE_MB` | `10`    | Maximum feed response size in MB        |
| `MAX_HTML_SIZE_MB`     | `5`     | Maximum HTML size for parsing in MB     |
| `DEFAULT_TIMEOUT_MS`   | `10000` | Default request timeout in milliseconds |
| `MAX_TIMEOUT_MS`       | `30000` | Maximum allowed timeout in milliseconds |

### Example with All Options

```bash
docker run -d \
  -p 3000:3000 \
  -e BAB_API_KEY=your-secret-key \
  -e ALLOWED_ORIGINS=https://blogsareback.com,https://myapp.com \
  -e MAX_RESPONSE_SIZE_MB=20 \
  -e DEFAULT_TIMEOUT_MS=15000 \
  --name bab-proxy \
  blogsareback/bab-proxy
```

## Using with BAB

1. Deploy the proxy using one of the methods above
2. Note your proxy URL (e.g., `http://your-server:3000` or `https://proxy.yourdomain.com`)
3. In Blogs Are Back: Go to **Settings** → **Custom Proxy**
4. Enter your proxy URL and API key (if configured)
5. Click **Validate** to test the connection
6. Enable the proxy

## Security

### API Key Authentication

If `BAB_API_KEY` is set, all requests must include the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-secret-key" http://localhost:3000/health
```

### SSRF Protection

The proxy blocks requests to:

- Private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x)
- Link-local addresses (169.254.x.x)
- Cloud metadata endpoints (169.254.169.254, metadata.google.internal)
- localhost and \*.local domains

### HTTPS

For production, run the proxy behind a reverse proxy (nginx, Caddy, Traefik) with HTTPS.

## Deploy to Cloud

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/bab-proxy)

### Fly.io

```bash
fly launch --image blogsareback/bab-proxy
fly secrets set BAB_API_KEY=your-secret-key
```

### Render

Use Docker deployment with the repository URL.

### Any VPS

```bash
# SSH to your server
ssh user@your-server

# Run the container
docker run -d \
  -p 3000:3000 \
  -e BAB_API_KEY=your-secret-key \
  --restart unless-stopped \
  --name bab-proxy \
  blogsareback/bab-proxy
```

## Exposing Your Proxy

If you're running the proxy on a home server, NAS, or local machine, you'll need to expose it to the internet so Blogs Are Back can reach it. Here are several options:

### Cloudflare Tunnel (Recommended)

Free, secure, and production-ready. No need to open ports on your router.

1. [Create a Cloudflare account](https://dash.cloudflare.com/sign-up) and add a domain
2. Install cloudflared:
   ```bash
   # macOS
   brew install cloudflared

   # Linux
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
   chmod +x cloudflared
   sudo mv cloudflared /usr/local/bin/
   ```
3. Authenticate:
   ```bash
   cloudflared tunnel login
   ```
4. Create and run the tunnel:
   ```bash
   cloudflared tunnel create bab-proxy
   cloudflared tunnel route dns bab-proxy proxy.yourdomain.com
   cloudflared tunnel run --url http://localhost:3000 bab-proxy
   ```

Your proxy will be available at `https://proxy.yourdomain.com`.

For a persistent setup, [create a config file](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/as-a-service/) and run cloudflared as a service.

### Tailscale Funnel

If you already use Tailscale, Funnel is the easiest option.

1. [Enable Funnel](https://tailscale.com/kb/1223/funnel) in your Tailscale admin console
2. Serve your proxy:
   ```bash
   tailscale funnel 3000
   ```

Your proxy will be available at `https://your-machine-name.tailnet-name.ts.net`.

### ngrok

Great for quick testing. Free tier has limitations (random URLs, session limits).

1. [Sign up for ngrok](https://ngrok.com/) and install it
2. Add your auth token:
   ```bash
   ngrok config add-authtoken YOUR_TOKEN
   ```
3. Start the tunnel:
   ```bash
   ngrok http 3000
   ```

Copy the forwarding URL (e.g., `https://abc123.ngrok.io`) to use in BAB.

For a stable URL, upgrade to a paid plan or use a custom domain.

### Other Options

- **[localtunnel](https://localtunnel.github.io/www/)** - Simple, no signup: `npx localtunnel --port 3000`
- **[bore](https://github.com/ekzhang/bore)** - Minimal, self-hostable: `bore local 3000 --to bore.pub`
- **Reverse proxy on VPS** - Run nginx/Caddy on a cheap VPS and tunnel to it via SSH or WireGuard

## Development

### Prerequisites

- Node.js 20+
- npm

### Local Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

### Type Checking

```bash
npm run typecheck
```

## License

MIT
