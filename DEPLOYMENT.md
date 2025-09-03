# Moodvestor Dashboard Deployment Guide

This guide covers multiple deployment options for the Moodvestor Dashboard.

## 🚀 Quick Deploy Options

### Option 1: Vercel (Recommended for Frontend)

1. **Via GitHub Integration (Easiest)**:
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import from GitHub: `camellk24/Moodvestor-dashboard`
   - Vercel will auto-detect the static site and deploy

2. **Via CLI**:
   ```bash
   npm install -g vercel
   vercel login
   vercel --prod
   ```

### Option 2: Railway (Containerized)

1. **Via Railway Dashboard**:
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select `camellk24/Moodvestor-dashboard`
   - Railway will auto-detect the Dockerfile and deploy

### Option 3: Netlify

1. **Via GitHub Integration**:
   - Go to [netlify.com](https://netlify.com)
   - Click "New site from Git"
   - Connect GitHub and select `camellk24/Moodvestor-dashboard`

## 🔄 Automatic Deployments (CI/CD)

The repository includes GitHub Actions workflows for automatic deployment:

### Vercel Auto-Deploy
- **File**: `.github/workflows/deploy-vercel.yml`
- **Triggers**: Push to `main` branch
- **Setup**: Add these secrets to GitHub repository:
  - `VERCEL_TOKEN`: Get from Vercel dashboard → Settings → Tokens
  - `ORG_ID`: Get from Vercel dashboard → Settings → General
  - `PROJECT_ID`: Get from Vercel dashboard → Settings → General

### Railway Auto-Deploy
- **File**: `.github/workflows/deploy-railway.yml`
- **Triggers**: Push to `main` branch
- **Setup**: Add this secret to GitHub repository:
  - `RAILWAY_TOKEN`: Get from Railway dashboard → Account → Tokens

## 🌐 Accessing the Dashboard

Once deployed, the dashboard will be available at:
- **Vercel**: `https://www.vibebullish.com/dashboard` (or custom domain)
- **Railway**: `https://www.vibebullish.com/dashboard` (or custom domain)
- **Netlify**: `https://www.vibebullish.com/dashboard` (or custom domain)

## 🔗 Backend Integration

The dashboard connects to the Moodvestor backend API:
- **Production**: `https://api.vibebullish.com`
- **Endpoints**: 
  - `/api/data-pipeline/reports` - Get reports
  - `/api/data-pipeline/dashboard` - Dashboard data
