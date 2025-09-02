# Moodvestor Data Pipeline Dashboard

A modern web dashboard for monitoring Moodvestor's data pipeline, vibe score calculations, and system health.

## 🚀 Features

- **Real-time Monitoring** - Live updates every 30 seconds
- **Multi-page Interface** - Overview, Reports, Vibe Scores, System Health
- **Vibe Score Analytics** - Track default values and calculation issues
- **System Health** - Monitor database, AI services, and overall status
- **Responsive Design** - Works on desktop and mobile devices

## 📊 Pages

### Overview
- System metrics and KPIs
- Recent reports summary
- Quick status indicators

### Reports
- Detailed view of all data pipeline reports
- Filter by status, type, and date
- Recommendations and alerts

### Vibe Scores
- Vibe score calculation statistics
- Default value tracking
- Issue detection and alerts

### System Health
- Database connectivity status
- AI service health
- Performance metrics

## 🛠️ Setup

### Option 1: Static Hosting (Recommended)

Deploy to any static hosting service:

- **Vercel**: `vercel --prod`
- **Netlify**: Drag and drop the folder
- **GitHub Pages**: Push to `gh-pages` branch
- **Railway**: Use static site deployment

### Option 2: Local Development

```bash
# Serve locally with Python
python -m http.server 8000

# Or with Node.js
npx serve .

# Or with any static file server
```

### Option 3: Docker

```bash
# Build and run
docker build -t moodvestor-dashboard .
docker run -p 8080:80 moodvestor-dashboard
```

## ⚙️ Configuration

Update the backend URL in `index.html`:

```javascript
const BACKEND_URL = 'https://moodvestor-backend-production.up.railway.app';
```

## 🔗 API Endpoints

The dashboard connects to these backend endpoints:

- `GET /api/data-pipeline/dashboard` - Dashboard metrics
- `GET /api/data-pipeline/reports` - Recent reports
- `GET /health` - Backend health check

## 📱 Mobile Support

The dashboard is fully responsive and works on:
- Desktop browsers
- Tablets
- Mobile phones
- Progressive Web App (PWA) ready

## 🎨 Customization

### Styling
- Modify CSS variables in `index.html`
- Update color scheme in the `:root` section
- Customize component styles

### Features
- Add new pages by extending the navigation
- Modify refresh intervals
- Add new metrics and charts

## 🚀 Deployment

### Vercel (Recommended)
```bash
npm install -g vercel
vercel --prod
```

### Netlify
1. Drag and drop the folder to Netlify
2. Set build command: `echo "Static site"`
3. Set publish directory: `.`

### Railway
1. Create new Railway project
2. Connect GitHub repository
3. Set deployment type to "Static Site"

## 🔧 Development

### Adding New Pages

1. Add navigation link in the `.nav` section
2. Create new page div with `[page-name]-page` ID
3. Add `showPage()` case in the switch statement
4. Implement page-specific loading function

### Adding New Metrics

1. Add metric card to the appropriate page
2. Update the corresponding loading function
3. Add data processing logic
4. Update the display function

## 📊 Monitoring

The dashboard automatically:
- Refreshes data every 30 seconds
- Shows loading states during API calls
- Displays error messages for failed requests
- Maintains navigation state

## 🎯 Vibe Score Monitoring

The dashboard specifically tracks:
- **Default Values** - When vibe scores use 0.5 instead of calculated values
- **Calculation Failures** - When vibe score calculations fail
- **Score Distribution** - How scores are distributed across ranges
- **Average Scores** - Overall vibe score trends

## 🚨 Alerts

The dashboard will show alerts for:
- High number of default vibe scores (>50%)
- Low average vibe scores (<0.3)
- Critical system issues
- Data quality problems

## 📈 Future Enhancements

- [ ] Real-time charts and graphs
- [ ] Export functionality for reports
- [ ] Email/SMS notifications
- [ ] User authentication
- [ ] Custom dashboards
- [ ] Historical data analysis
- [ ] Performance metrics
- [ ] Error tracking and debugging

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is part of the Moodvestor ecosystem and follows the same licensing terms.
