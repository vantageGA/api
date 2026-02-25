# Environment Configuration Guide

## Current .env Configuration Status

### ✅ All Required Variables Present

Your `.env` file has been validated and contains all required environment variables:

```env
NODE_ENV=development
PORT=5000
MONGO_URI=mongodb+srv://bodyVantageData:***@bodyvantage.esb8j.mongodb.net/BodyVantageData
JWT_SECRET=***
MAILER_HOST=mail.bodyvantage.co.uk
MAILER_USER=software@bodyvantage.co.uk
MAILER_PW=***
MAILER_LOCAL_URL=http://localhost:5000/
CLOUDINARY_CLOUD_NAME=bodyvantage
CLOUDINARY_API_KEY=***
CLOUDINARY_SECRET=***
RESET_PASSWORD_LOCAL_URL=http://localhost:5173
```

---

## ⚠️ Security Warnings for Production

### 1. JWT_SECRET Strength (IMPORTANT)

**Current Status:** Your JWT_SECRET is only 9 characters long.

**Issue:** This is significantly below the recommended 32 characters for production use.

**Risk Level:**
- ✅ **Development:** Acceptable for local development
- ⚠️ **Production:** CRITICAL - Must be changed before deployment

**Recommended Action:**
Generate a strong JWT_SECRET using one of these methods:

```bash
# Method 1: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Method 2: Using OpenSSL
openssl rand -base64 32

# Method 3: Using online generator (use a trusted source)
# Visit: https://www.grc.com/passwords.htm
```

**Example strong JWT_SECRET:**
```env
JWT_SECRET=a8f5f167f44f4964e6c998dee827110c03c2aa3b2c3c40d8e8c5e0d0c5a0a0a0
```

### 2. Production Environment Configuration

Before deploying to production, update your `.env` file:

```env
NODE_ENV=production
PORT=5000  # Or your production port
MONGO_URI=mongodb+srv://[production-credentials]
JWT_SECRET=[strong-32+-character-secret]
MAILER_HOST=mail.bodyvantage.co.uk
MAILER_USER=software@bodyvantage.co.uk
MAILER_PW=[production-password]
MAILER_LOCAL_URL=https://yourdomain.com/  # HTTPS required!
CLOUDINARY_CLOUD_NAME=bodyvantage
CLOUDINARY_API_KEY=[your-key]
CLOUDINARY_SECRET=[your-secret]
RESET_PASSWORD_LOCAL_URL=https://yourdomain.com  # HTTPS required!
```

**Key Changes for Production:**
1. ✅ Set `NODE_ENV=production`
2. ✅ Use HTTPS URLs (not HTTP)
3. ✅ Use strong, unique JWT_SECRET (32+ characters)
4. ✅ Use production database credentials
5. ✅ Use production email credentials
6. ✅ Never commit `.env` to version control

---

## Environment Variable Reference

### Required Variables

| Variable | Description | Example | Notes |
|----------|-------------|---------|-------|
| `NODE_ENV` | Environment mode | `development`, `production`, `test` | Controls security checks |
| `PORT` | Server port | `5000` | 1-65535 |
| `MONGO_URI` | MongoDB connection string | `mongodb+srv://...` | Can also use `MONGODB_URI` |
| `JWT_SECRET` | Secret for JWT signing | `your-secret-key` | Min 16 chars (dev), 32+ (prod) |
| `MAILER_HOST` | SMTP server | `mail.bodyvantage.co.uk` | Your email provider |
| `MAILER_USER` | Email username | `software@bodyvantage.co.uk` | For sending emails |
| `MAILER_PW` | Email password | `your-password` | Keep secure |
| `MAILER_LOCAL_URL` | API base URL | `http://localhost:5000/` | For email links |
| `RESET_PASSWORD_LOCAL_URL` | Frontend URL | `http://localhost:5173` | For password reset |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account | `bodyvantage` | For image uploads |
| `CLOUDINARY_API_KEY` | Cloudinary key | `your-key` | From Cloudinary dashboard |
| `CLOUDINARY_SECRET` | Cloudinary secret | `your-secret` | From Cloudinary dashboard |

### Optional Variables

| Variable | Description | Default | Notes |
|----------|-------------|---------|-------|
| `FRONTEND_URL` | Frontend origin | - | For CORS configuration |
| `ONBOARDING_TUTORIAL_ENFORCED` | Enforce onboarding tutorial before `PUT /api/profile` | `true` in production when unset | Set to `false` for emergency rollback (must be `true` or `false`) |

---

## Validation on Startup

The server now validates environment variables on startup:

### Development Mode Checks
- ✅ All required variables are present
- ⚠️ Warns if JWT_SECRET < 32 characters
- ⚠️ Warns if URLs are invalid
- ⚠️ Warns if PORT is invalid

### Production Mode Checks
- ✅ All required variables are present
- ❌ **Blocks startup** if JWT_SECRET < 16 characters
- ❌ **Blocks startup** if JWT_SECRET is default value
- ⚠️ Warns if JWT_SECRET < 32 characters
- ⚠️ Warns if URLs are invalid

---

## MongoDB Connection

The system accepts either environment variable name:

- `MONGO_URI` ← **Your current configuration**
- `MONGODB_URI` ← Alternative name (also supported)

**Connection String Format:**
```
mongodb+srv://username:password@cluster.mongodb.net/database?options
```

**Validation:**
- Must start with `mongodb://` or `mongodb+srv://`
- Should include authentication credentials
- Should specify database name

---

## Email Configuration

### Current Setup
- **Host:** `mail.bodyvantage.co.uk`
- **User:** `software@bodyvantage.co.uk`
- **Security:** TLS 1.2+ with certificate validation enabled

### Email Features
1. **Registration:** Sends verification email
2. **Password Reset:** Sends reset link (15-minute expiry)
3. **Email Change:** Sends verification to new address
4. **Password Changed:** Sends confirmation email

### Testing Emails in Development

During development, emails will include console output:
```
Message sent: <message-id>
Preview URL: https://ethereal.email/message/...
```

---

## Frontend URLs

### Development
```env
MAILER_LOCAL_URL=http://localhost:5000/
RESET_PASSWORD_LOCAL_URL=http://localhost:5173
```

### Production
```env
MAILER_LOCAL_URL=https://api.yourdomain.com/
RESET_PASSWORD_LOCAL_URL=https://yourdomain.com
```

**Note:** Production must use HTTPS for security.

---

## Security Best Practices

### 1. Never Commit .env to Git
```bash
# Ensure .env is in .gitignore
echo ".env" >> .gitignore
```

### 2. Use Environment-Specific Files
```
.env.development    # Local development
.env.production     # Production (on server only)
.env.test          # Testing
```

### 3. Rotate Secrets Regularly
- Change JWT_SECRET every 90 days in production
- Change email passwords according to your policy
- Rotate API keys when team members leave

### 4. Use Secrets Management in Production
Consider using:
- AWS Secrets Manager
- Azure Key Vault
- HashiCorp Vault
- Kubernetes Secrets
- Environment variables in hosting platform (Heroku, Vercel, etc.)

---

## Troubleshooting

### Server Won't Start

**Error:** "Missing required environment variables"
- **Solution:** Check that all variables in the list above are set

**Error:** "FATAL ERROR: JWT_SECRET must be at least 16 characters"
- **Solution:** Set a longer JWT_SECRET (see section above)

**Error:** "Not a valid URL"
- **Solution:** Ensure URLs start with `http://` or `https://`

### Database Connection Fails

**Error:** "Mongo connection string missing"
- **Solution:** Set either `MONGO_URI` or `MONGODB_URI`

**Error:** Connection timeout
- **Solution:** Check MongoDB connection string, network access, and credentials

### Email Sending Fails

**Error:** "Failed to send verification email"
- **Solution:**
  1. Check MAILER_HOST, MAILER_USER, MAILER_PW
  2. Verify SMTP settings with your email provider
  3. Check firewall/network settings
  4. Ensure port 587 is open

---

## Current Warnings (Development Mode)

When you start the server, you may see:

```
⚠️  Environment configuration warnings:
   - JWT_SECRET is only 9 characters. Recommended minimum: 32 characters for production security
```

**This is expected in development but must be fixed before production deployment.**

---

## Quick Start Checklist

### For Development (Current Setup)
- [x] All required variables set
- [x] MongoDB connection working
- [x] Email configuration set
- [x] Cloudinary configured
- [ ] Consider strengthening JWT_SECRET for testing production flows

### For Production Deployment
- [ ] Change NODE_ENV to `production`
- [ ] Generate strong JWT_SECRET (32+ characters)
- [ ] Update URLs to use HTTPS
- [ ] Verify production MongoDB credentials
- [ ] Test email sending in production environment
- [ ] Verify Cloudinary works in production
- [ ] Set up monitoring for environment issues
- [ ] Document production secrets securely

---

**Last Updated:** 2025-12-31
**Configuration Status:** ✅ Development Ready | ⚠️ Production Requires Updates
