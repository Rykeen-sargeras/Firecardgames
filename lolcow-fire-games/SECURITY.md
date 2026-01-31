# Security Policy

## 🔒 Sensitive Information

**NEVER commit the following to this repository:**

- `.env` files with real credentials
- Admin passwords
- API keys or tokens
- Private keys (`.pem`, `.key` files)
- Database connection strings
- Any production secrets

## 🛡️ Environment Variables

All sensitive configuration should be set via environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `ADMIN_PASS` | Password for admin panel | Yes (for production) |
| `PORT` | Server port | No (defaults to 3000) |

### Setting Environment Variables

**Local Development:**
```bash
cp .env.example .env
# Edit .env with your values
```

**Render.com:**
1. Go to your service dashboard
2. Click "Environment"
3. Add each variable

**Other Platforms:**
- Heroku: Settings → Config Vars
- Vercel: Settings → Environment Variables
- Railway: Variables tab

## 🚨 Reporting Vulnerabilities

If you discover a security vulnerability, please:

1. **DO NOT** open a public issue
2. Contact the maintainer directly
3. Provide details of the vulnerability
4. Allow time for a fix before disclosure

## ✅ Security Checklist

Before deploying to production:

- [ ] Changed default admin password
- [ ] Set `NODE_ENV=production`
- [ ] Verified `.env` is in `.gitignore`
- [ ] No hardcoded secrets in code
- [ ] HTTPS enabled (handled by Render/hosting)

## 🔐 Default Credentials

The default admin password is `Firesluts`. 

**⚠️ CHANGE THIS IMMEDIATELY IN PRODUCTION** by setting the `ADMIN_PASS` environment variable.
