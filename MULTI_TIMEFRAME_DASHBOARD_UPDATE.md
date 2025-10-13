# Dashboard Update for Multi-Timeframe Price Targets

## Overview
The dashboard needs to be updated to display all 6 timeframe price targets + LightGBM predictions for each ticker.

## Current State
- Dashboard shows single price target per ticker (buy_target, sell_target, upside_percent)
- No timeframe breakdown
- No LightGBM vs Trading Agents comparison

## Required Changes

### 1. Backend API Update
Create a new endpoint: `GET /api/stocks/:ticker/price-targets/all`

Response:
```json
{
  "ticker": "AAPL",
  "current_price": 175.50,
  "trading_agents": [
    {
      "time_horizon": "1D",
      "buy_target": 174.00,
      "sell_target": 177.00,
      "confidence": 0.85,
      "upside_percent": 0.85,
      "generated_at": "2025-10-13T10:00:00Z"
    },
    {
      "time_horizon": "1W",
      "buy_target": 172.00,
      "sell_target": 182.00,
      "confidence": 0.80,
      "upside_percent": 3.70,
      "generated_at": "2025-10-13T10:00:00Z"
    },
    // ... 4 more timeframes (1M, 6M, 12M, >12M)
  ],
  "lightgbm": {
    "predicted_price_1d": 176.20,
    "predicted_price_5d": 178.50,
    "predicted_price_20d": 182.00,
    "generated_at": "2025-10-13T09:00:00Z"
  }
}
```

### 2. Dashboard UI Changes

#### Add Collapsible Timeframe Section
```html
<div class="timeframe-breakdown">
  <button class="expand-button" onclick="toggleTimeframes('AAPL')">
    📊 View All Timeframes (6)
  </button>
  
  <div id="timeframes-AAPL" class="timeframe-details" style="display: none;">
    <!-- Trading Agents Section -->
    <div class="timeframe-section">
      <h4>🤖 Trading Agents (GPT-4o mini)</h4>
      <table class="timeframe-table">
        <thead>
          <tr>
            <th>Horizon</th>
            <th>Buy Target</th>
            <th>Sell Target</th>
            <th>Upside</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>⚡ 1 Day</td>
            <td>$174.00</td>
            <td>$177.00</td>
            <td>+0.85%</td>
            <td>85%</td>
          </tr>
          <tr>
            <td>📅 1 Week</td>
            <td>$172.00</td>
            <td>$182.00</td>
            <td>+3.70%</td>
            <td>80%</td>
          </tr>
          <tr>
            <td>📆 1 Month</td>
            <td>$170.00</td>
            <td>$188.00</td>
            <td>+7.12%</td>
            <td>75%</td>
          </tr>
          <tr>
            <td>📊 6 Months</td>
            <td>$165.00</td>
            <td>$205.00</td>
            <td>+16.81%</td>
            <td>70%</td>
          </tr>
          <tr>
            <td>📈 12 Months</td>
            <td>$160.00</td>
            <td>$225.00</td>
            <td>+28.20%</td>
            <td>65%</td>
          </tr>
          <tr>
            <td>🚀 12+ Months</td>
            <td>$155.00</td>
            <td>$250.00</td>
            <td>+42.48%</td>
            <td>60%</td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- LightGBM Section -->
    <div class="lightgbm-section">
      <h4>🤖 LightGBM (ML Model)</h4>
      <table class="timeframe-table">
        <thead>
          <tr>
            <th>Horizon</th>
            <th>Predicted Price</th>
            <th>Upside</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1 Day</td>
            <td>$176.20</td>
            <td>+0.40%</td>
          </tr>
          <tr>
            <td>5 Days</td>
            <td>$178.50</td>
            <td>+1.71%</td>
          </tr>
          <tr>
            <td>20 Days</td>
            <td>$182.00</td>
            <td>+3.70%</td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Comparison Chart -->
    <div class="comparison-chart">
      <h4>📈 Price Trajectory Comparison</h4>
      <canvas id="chart-AAPL"></canvas>
    </div>
  </div>
</div>
```

#### Add CSS
```css
.timeframe-breakdown {
  margin-top: 15px;
  border-top: 1px solid #e2e8f0;
  padding-top: 15px;
}

.expand-button {
  background: #667eea;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  width: 100%;
}

.expand-button:hover {
  background: #5a67d8;
}

.timeframe-details {
  margin-top: 15px;
  padding: 15px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.timeframe-section,
.lightgbm-section {
  margin-bottom: 20px;
}

.timeframe-section h4,
.lightgbm-section h4 {
  margin: 0 0 10px 0;
  color: #1e293b;
}

.timeframe-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
}

.timeframe-table th {
  background: #f8fafc;
  padding: 8px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid #e2e8f0;
}

.timeframe-table td {
  padding: 8px;
  border-bottom: 1px solid #e2e8f0;
}

.timeframe-table tbody tr:hover {
  background: #f8fafc;
}

.comparison-chart {
  margin-top: 20px;
}

.comparison-chart canvas {
  max-height: 300px;
}
```

#### Add JavaScript
```javascript
function toggleTimeframes(ticker) {
  const detailsDiv = document.getElementById(`timeframes-${ticker}`);
  const button = event.target;
  
  if (detailsDiv.style.display === 'none') {
    // Load data if not loaded yet
    if (!detailsDiv.dataset.loaded) {
      loadTimeframeData(ticker);
      detailsDiv.dataset.loaded = 'true';
    }
    detailsDiv.style.display = 'block';
    button.textContent = '📊 Hide Timeframes';
  } else {
    detailsDiv.style.display = 'none';
    button.textContent = '📊 View All Timeframes (6)';
  }
}

async function loadTimeframeData(ticker) {
  try {
    const response = await fetch(`https://api.vibebullish.com/api/stocks/${ticker}/price-targets/all`);
    const data = await response.json();
    
    renderTimeframeTable(ticker, data);
    renderComparisonChart(ticker, data);
  } catch (error) {
    console.error(`Error loading timeframes for ${ticker}:`, error);
  }
}

function renderTimeframeTable(ticker, data) {
  // Populate the table with actual data
  // (Implementation details)
}

function renderComparisonChart(ticker, data) {
  // Use Chart.js to render a line chart comparing timeframes
  // (Implementation details)
}
```

## Priority
**Medium** - This is a nice-to-have enhancement that provides better visibility into the multi-timeframe system, but the core functionality already works in the iOS app.

## Next Steps
1. ✅ Backend multi-timeframe system (DONE)
2. ✅ iOS UI filters (DONE)
3. 🔄 Dashboard enhancement (IN PROGRESS - documented here)
4. Future: Add Chart.js library for visual comparison

## Notes
- Consider using Chart.js or similar library for visual timeline
- Add export functionality to CSV/JSON
- Add date range filter to see historical predictions vs actuals

