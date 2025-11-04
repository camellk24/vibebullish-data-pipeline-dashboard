// Dashboard JavaScript
const API_BASE = 'https://api.vibebullish.com/api/data-pipeline';
const COST_OPT_API_BASE = 'https://api.vibebullish.com/api/cost-optimization';
let currentReports = [];
let currentTickers = [];
let currentPage = 1;
const reportsPerPage = 10;
let costMetrics = null;

// Helper function to format processing time
function formatProcessingTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return timeStr;
    
    // Parse format like "8m13.041751456s"
    const match = timeStr.match(/(\d+)m(\d+\.?\d*)s/);
    if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseFloat(match[2]);
        const totalSeconds = minutes * 60 + seconds;
        
        if (totalSeconds >= 60) {
            // Show as minutes with 1 decimal place
            return `${(totalSeconds / 60).toFixed(1)}m`;
        } else {
            // Show as seconds with 1 decimal place
            return `${totalSeconds.toFixed(1)}s`;
        }
    }
    
    return timeStr; // Return original if parsing fails
}

// Helper function to format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 4,
        maximumFractionDigits: 4
    }).format(amount);
}

// Helper function to format percentage
function formatPercentage(value) {
    return `${(value * 100).toFixed(1)}%`;
}

// Helper function to determine trading strategy based on AI rating and upside
function getTradingStrategy(ticker) {
    const aiRating = ticker.ai_rating || 0;
    const upside = ticker.upside_percent || 0;
    
    // High AI Rating (>60%) + Positive Upside (>10%) = Strong Buy
    if (aiRating > 0.6 && upside > 10) {
        return {
            class: 'strategy-strong-buy',
            label: '🚀 Strong Buy',
            explanation: 'High quality stock with good upside potential'
        };
    }
    
    // High AI Rating (>60%) + Moderate Upside (0-10%) = Buy
    if (aiRating > 0.6 && upside >= 0 && upside <= 10) {
        return {
            class: 'strategy-buy',
            label: '✅ Buy',
            explanation: 'Quality stock, modest upside'
        };
    }
    
    // High AI Rating (>60%) + Negative Upside = Wait & Watch
    if (aiRating > 0.6 && upside < 0) {
        return {
            class: 'strategy-wait',
            label: '⏳ Wait & Watch',
            explanation: 'Quality stock but overvalued - wait for pullback'
        };
    }
    
    // Moderate AI Rating (40-60%) + High Upside (>20%) = Speculative Buy
    if (aiRating >= 0.4 && aiRating <= 0.6 && upside > 20) {
        return {
            class: 'strategy-speculative',
            label: '⚠️ Speculative Buy',
            explanation: 'High upside but moderate quality - higher risk'
        };
    }
    
    // Moderate AI Rating (40-60%) + Any Upside = Hold
    if (aiRating >= 0.4 && aiRating <= 0.6) {
        return {
            class: 'strategy-hold',
            label: '🤝 Hold',
            explanation: 'Moderate quality - hold if owned, avoid new positions'
        };
    }
    
    // Low AI Rating (<40%) = Avoid
    return {
        class: 'strategy-avoid',
        label: '❌ Avoid',
        explanation: 'Low quality stock - avoid regardless of upside'
    };
}

// Load cost optimization page
async function loadCostOptimization() {
    await loadCostMetrics();
    await loadCostOptimizationDetails();
}

// Load cost optimization metrics
async function loadCostMetrics() {
    try {
        const response = await fetch(`${COST_OPT_API_BASE}/metrics`);
        const data = await response.json();
        costMetrics = data;
        displayCostMetrics();
    } catch (error) {
        console.error('Error loading cost metrics:', error);
        // Show fallback data
        costMetrics = {
            ml_model_cost: 0.0,
            genai_cost: 0.0,
            total_requests: 0,
            ml_model_requests: 0,
            genai_requests: 0,
            average_latency: 0,
            cost_savings: 0.0
        };
        displayCostMetrics();
    }
}

// Load detailed cost optimization data
async function loadCostOptimizationDetails() {
    try {
        const response = await fetch(`${COST_OPT_API_BASE}/details`);
        const data = await response.json();
        displayCostOptimizationDetails(data);
    } catch (error) {
        console.error('Error loading cost optimization details:', error);
        displayCostOptimizationDetails(null);
    }
}

// Display detailed cost optimization information
function displayCostOptimizationDetails(data) {
    const container = document.getElementById('cost-optimization-details');
    if (!container) return;
    
    if (!data) {
        container.innerHTML = '<div class="error">Failed to load cost optimization details</div>';
        return;
    }
    
    container.innerHTML = `
        <div class="cost-optimization-content">
            <div class="section">
                <h3>📊 Usage Breakdown by Analysis Type</h3>
                <div class="usage-breakdown">
                    ${Object.entries(data.usage_by_type || {}).map(([type, metrics]) => `
                        <div class="usage-item">
                            <div class="usage-type">${type}</div>
                            <div class="usage-stats">
                                <span class="ml-usage">ML: ${metrics.ml_requests || 0}</span>
                                <span class="genai-usage">GenAI: ${metrics.genai_requests || 0}</span>
                                <span class="total-cost">Cost: ${formatCurrency(metrics.total_cost || 0)}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div class="section">
                <h3>🎯 Optimization Recommendations</h3>
                <div class="recommendations">
                    ${data.recommendations ? data.recommendations.map(rec => `
                        <div class="recommendation-item">
                            <div class="recommendation-type">${rec.analysis_type}</div>
                            <div class="recommendation-text">${rec.recommendation}</div>
                            <div class="recommendation-savings">Potential savings: ${formatCurrency(rec.potential_savings || 0)}</div>
                        </div>
                    `).join('') : '<div class="no-recommendations">No recommendations available</div>'}
                </div>
            </div>
            
            <div class="section">
                <h3>📈 Performance Trends</h3>
                <div class="performance-trends">
                    <div class="trend-item">
                        <div class="trend-label">ML Model Usage</div>
                        <div class="trend-value">${data.ml_usage_trend || '0%'} ↗️</div>
                    </div>
                    <div class="trend-item">
                        <div class="trend-label">Cost Reduction</div>
                        <div class="trend-value">${data.cost_reduction_trend || '0%'} ↘️</div>
                    </div>
                    <div class="trend-item">
                        <div class="trend-label">Response Time</div>
                        <div class="trend-value">${data.latency_trend || '0ms'} ⚡</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Display cost optimization metrics
function displayCostMetrics() {
    if (!costMetrics) return;
    
    const container = document.getElementById('cost-metrics');
    if (!container) return;
    
    const totalCost = costMetrics.ml_model_cost + costMetrics.genai_cost;
    const mlPercentage = costMetrics.total_requests > 0 ? 
        (costMetrics.ml_model_requests / costMetrics.total_requests) * 100 : 0;
    const genaiPercentage = costMetrics.total_requests > 0 ? 
        (costMetrics.genai_requests / costMetrics.total_requests) * 100 : 0;
    
    container.innerHTML = `
        <div class="cost-metrics-grid">
            <div class="metric-card">
                <h3>💰 Total Cost</h3>
                <div class="metric-value">${formatCurrency(totalCost)}</div>
                <div class="metric-subtitle">Last 24 hours</div>
            </div>
            <div class="metric-card">
                <h3>🤖 ML Models</h3>
                <div class="metric-value">${formatCurrency(costMetrics.ml_model_cost)}</div>
                <div class="metric-subtitle">${mlPercentage.toFixed(1)}% of requests</div>
            </div>
            <div class="metric-card">
                <h3>🧠 GenAI</h3>
                <div class="metric-value">${formatCurrency(costMetrics.genai_cost)}</div>
                <div class="metric-subtitle">${genaiPercentage.toFixed(1)}% of requests</div>
            </div>
            <div class="metric-card">
                <h3>📊 Cost Savings</h3>
                <div class="metric-value">${formatPercentage(costMetrics.cost_savings)}</div>
                <div class="metric-subtitle">vs all GenAI</div>
            </div>
            <div class="metric-card">
                <h3>⚡ Avg Latency</h3>
                <div class="metric-value">${costMetrics.average_latency}ms</div>
                <div class="metric-subtitle">Response time</div>
            </div>
            <div class="metric-card">
                <h3>📈 Total Requests</h3>
                <div class="metric-value">${costMetrics.total_requests.toLocaleString()}</div>
                <div class="metric-subtitle">Last 24 hours</div>
            </div>
        </div>
    `;
}

// Ticker Analysis Page
let allTickers = [];
let filteredTickers = [];
let currentSort = 'ai-rating'; // Default to AI Rating sort
let currentFilter = 'all';
let currentTimeframe = 'all';

// Page Navigation
function showPage(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Remove active class from all nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    // Show selected page
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // Add active class to clicked nav link
    const activeLink = document.querySelector(`[data-page="${pageId}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }
    
    // Load page data
    if (pageId === 'overview') {
        loadOverview();
    } else if (pageId === 'reports') {
        loadReports();
    } else if (pageId === 'tickers') {
        loadTickers();
    } else if (pageId === 'schedule') {
        loadSchedule();
    } else if (pageId === 'cost-optimization') {
        loadCostOptimization();
    }
}

// Overview Page
async function loadOverview() {
    try {
        const response = await fetch(`${API_BASE}/reports?limit=1&t=${Date.now()}`);
        const data = await response.json();
        
        // Also load cost metrics for overview
        await loadCostMetrics();
        
        if (data.reports && data.reports.length > 0) {
            const latestReport = data.reports[0];
            displaySystemStatus(latestReport);
            displayLatestReport(latestReport);
        } else {
            document.getElementById('system-status').innerHTML = '<div class="error">No reports available</div>';
            document.getElementById('latest-report').innerHTML = '<div class="error">No reports available</div>';
        }
        
        // Load schedule summary
        await loadScheduleSummary();
    } catch (error) {
        console.error('Error loading overview:', error);
        document.getElementById('system-status').innerHTML = '<div class="error">Failed to load system status</div>';
        document.getElementById('latest-report').innerHTML = '<div class="error">Failed to load latest report</div>';
    }
}

function displaySystemStatus(report) {
    const statusClass = report.status === 'success' ? 'status-success' : 
                      report.status === 'warning' ? 'status-warning' : 'status-error';
    
    document.getElementById('system-status').innerHTML = `
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">${report.summary.success_rate.toFixed(1)}%</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.total_tickers_processed}</div>
                <div class="metric-label">Tickers Processed</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.data_quality_score.toFixed(1)}%</div>
                <div class="metric-label">Data Quality</div>
            </div>
            <div class="metric-card">
                <div class="metric-value"><span class="status-badge ${statusClass}">${report.status}</span></div>
                <div class="metric-label">Overall Status</div>
            </div>
        </div>
    `;
}

function displayLatestReport(report) {
    const vibeStats = report.vibe_score_stats || {};
    const tickerCount = report.ticker_details ? report.ticker_details.length : 0;
    
    document.getElementById('latest-report').innerHTML = `
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">${vibeStats.total_calculated || 0}</div>
                <div class="metric-label">AI Ratings Calculated</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${(vibeStats.average_score || 0).toFixed(3)}</div>
                <div class="metric-label">Avg AI Rating</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${tickerCount}</div>
                <div class="metric-label">Detailed Tickers</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${formatProcessingTime(report.summary.processing_time)}</div>
                <div class="metric-label">Processing Time</div>
            </div>
        </div>
    `;
}

// Load schedule summary for overview
async function loadScheduleSummary() {
    try {
        const response = await fetch('https://api.vibebullish.com/api/data-ingestion/status');
        const data = await response.json();
        
        if (data.status) {
            displayScheduleSummary(data.status);
        }
    } catch (error) {
        console.error('Error loading schedule summary:', error);
    }
}

function displayScheduleSummary(status) {
    const nextRun = new Date(status.next_run);
    const now = new Date();
    const timeUntilNext = nextRun - now;
    
    const formatTime = (ms) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };
    
    const statusClass = status.is_running ? 'status-success' : 'status-error';
    
    // Add schedule summary to overview
    const scheduleHTML = `
        <h3>Data Ingestion Schedule</h3>
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">
                    <span class="status-badge ${statusClass}">${status.is_running ? 'Running' : 'Stopped'}</span>
                </div>
                <div class="metric-label">Job Status</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${status.interval_hours}h</div>
                <div class="metric-label">Interval</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${formatTime(timeUntilNext)}</div>
                <div class="metric-label">Next Run In</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${status.tickers}</div>
                <div class="metric-label">Active Tickers</div>
            </div>
        </div>
    `;
    
    // Insert schedule summary after the latest report
    const latestReportDiv = document.getElementById('latest-report');
    if (latestReportDiv && latestReportDiv.parentNode) {
        const scheduleDiv = document.createElement('div');
        scheduleDiv.innerHTML = scheduleHTML;
        latestReportDiv.parentNode.insertBefore(scheduleDiv, latestReportDiv.nextSibling);
    }
}

// Reports Page
async function loadReports() {
    try {
        const response = await fetch(`${API_BASE}/reports?limit=50&t=${Date.now()}`);
        const data = await response.json();
        currentReports = data.reports || [];
        displayReports();
    } catch (error) {
        console.error('Error loading reports:', error);
        document.getElementById('report-list').innerHTML = '<div class="error">Failed to load reports</div>';
    }
}

function displayReports() {
    const startIndex = (currentPage - 1) * reportsPerPage;
    const endIndex = startIndex + reportsPerPage;
    const reportsToShow = currentReports.slice(startIndex, endIndex);
    
    if (reportsToShow.length === 0) {
        document.getElementById('report-list').innerHTML = '<div class="error">No reports found</div>';
        return;
    }
    
    const reportsHTML = reportsToShow.map(report => {
        const statusClass = report.status === 'success' ? 'status-success' : 
                          report.status === 'warning' ? 'status-warning' : 'status-error';
        const tickerCount = report.ticker_details ? report.ticker_details.length : 0;
        
        return `
            <div class="report-item" data-report-id="${report.report_id}">
                <div class="report-header">
                    <div class="report-id">${report.report_id}</div>
                    <div class="report-timestamp">${new Date(report.timestamp).toLocaleString()}</div>
                </div>
                <div class="report-summary">
                    <div class="summary-item">
                        <div class="summary-value">${report.summary.success_rate.toFixed(1)}%</div>
                        <div class="summary-label">Success Rate</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${report.summary.total_tickers_processed}</div>
                        <div class="summary-label">Tickers</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${tickerCount}</div>
                        <div class="summary-label">Details</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${report.cost_metrics ? formatCurrency(report.cost_metrics.total_cost) : 'N/A'}</div>
                        <div class="summary-label">Total Cost</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${report.cost_metrics ? report.cost_metrics.genai_calls : 0}</div>
                        <div class="summary-label">GenAI Calls</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${report.cost_metrics ? report.cost_metrics.ml_model_calls : 0}</div>
                        <div class="summary-label">ML Calls</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value"><span class="status-badge ${statusClass}">${report.status}</span></div>
                        <div class="summary-label">Status</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById('report-list').innerHTML = `<div class="report-list">${reportsHTML}</div>`;
    
    // Add event listeners for report items
    document.querySelectorAll('.report-item').forEach(item => {
        item.addEventListener('click', () => {
            const reportId = item.dataset.reportId;
            showReportDetail(reportId);
        });
    });
    
    updatePagination();
}

function updatePagination() {
    const totalPages = Math.ceil(currentReports.length / reportsPerPage);
    if (totalPages <= 1) {
        document.getElementById('pagination').innerHTML = '';
        return;
    }
    
    let paginationHTML = '';
    for (let i = 1; i <= totalPages; i++) {
        const activeClass = i === currentPage ? 'active' : '';
        paginationHTML += `<button class="page-btn ${activeClass}" onclick="changePage(${i})">${i}</button>`;
    }
    
    document.getElementById('pagination').innerHTML = paginationHTML;
}

function changePage(page) {
    currentPage = page;
    displayReports();
}

// Report Detail Page
async function showReportDetail(reportId) {
    console.log('Showing report detail for:', reportId);
    showPage('report-detail');
    document.getElementById('report-detail-title').textContent = `Report: ${reportId}`;
    document.getElementById('report-detail-content').innerHTML = '<div class="loading">Loading report details...</div>';
    
    try {
        const response = await fetch(`${API_BASE}/reports`);
        const data = await response.json();
        const report = data.reports.find(r => r.report_id === reportId);
        
        if (report) {
            displayReportDetail(report);
        } else {
            document.getElementById('report-detail-content').innerHTML = '<div class="error">Report not found</div>';
        }
    } catch (error) {
        console.error('Error loading report detail:', error);
        document.getElementById('report-detail-content').innerHTML = '<div class="error">Failed to load report details</div>';
    }
}

function displayReportDetail(report) {
    const statusClass = report.status === 'success' ? 'status-success' : 
                      report.status === 'warning' ? 'status-warning' : 'status-error';
    
    let tickerDetailsHTML = '';
    if (report.ticker_details && report.ticker_details.length > 0) {
        tickerDetailsHTML = `
            <h3>Ticker Details (${report.ticker_details.length} tickers)</h3>
            <div class="ticker-grid">
                ${report.ticker_details.map(ticker => `
                    <div class="ticker-card">
                        <div class="ticker-header">
                            <div class="ticker-symbol">${ticker.ticker}</div>
                            <div class="ticker-price">$${ticker.current_price.toFixed(2)}</div>
                        </div>
                        <div class="ticker-details">
                            <div class="detail-item">
                                <span class="detail-label">AI Rating:</span>
                                <span class="detail-value">${ticker.ai_rating ? (ticker.ai_rating * 100).toFixed(1) + '%' : 'N/A'}</span>
                            </div>
                            ${ticker.ai_rating_breakdown ? `
                                <div class="detail-item">
                                    <span class="detail-label">Score Breakdown:</span>
                                    <div class="breakdown-details">
                                        ${Object.entries(ticker.ai_rating_breakdown.components || {}).map(([key, component]) => 
                                            `<div class="breakdown-item">
                                                <span class="breakdown-label">${key.replace(/_/g, ' ').toUpperCase()}:</span>
                                                <span class="breakdown-value">${(component.score * 100).toFixed(1)}%</span>
                                            </div>`
                                        ).join('')}
                                    </div>
                                </div>
                            ` : `<div class="detail-item"><span class="detail-label">Score Breakdown:</span><span class="detail-value">DEBUG: No breakdown data</span></div>`}
                            <div class="detail-item">
                                <span class="detail-label">Buy Target:</span>
                                <span class="detail-value">${ticker.buy_target ? '$' + ticker.buy_target.toFixed(2) : 
                                    (ticker.buy_target_reason ? ticker.buy_target_reason : 'N/A')}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Sell Target:</span>
                                <span class="detail-value">${ticker.sell_target ? '$' + ticker.sell_target.toFixed(2) : 
                                    (ticker.sell_target_reason ? ticker.sell_target_reason : 'N/A')}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Upside:</span>
                                <span class="detail-value">${ticker.upside_percent ? ticker.upside_percent.toFixed(1) + '%' : 'N/A'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Volume:</span>
                                <span class="detail-value">${(ticker.volume / 1000000).toFixed(1)}M</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Market Cap:</span>
                                <span class="detail-value">$${(ticker.market_cap / 1000000000).toFixed(1)}B</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    document.getElementById('report-detail-content').innerHTML = `
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">${report.summary.success_rate.toFixed(1)}%</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.total_tickers_processed}</div>
                <div class="metric-label">Tickers Processed</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.data_quality_score.toFixed(1)}%</div>
                <div class="metric-label">Data Quality</div>
            </div>
            <div class="metric-card">
                <div class="metric-value"><span class="status-badge ${statusClass}">${report.status}</span></div>
                <div class="metric-label">Status</div>
            </div>
        </div>
        
        <h3>AI Rating Statistics</h3>
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">${report.vibe_score_stats?.total_calculated || 0}</div>
                <div class="metric-label">Total Calculated</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${((report.vibe_score_stats?.average_score || 0) * 100).toFixed(1)}%</div>
                <div class="metric-label">Average Rating</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.vibe_score_stats?.default_values_used || 0}</div>
                <div class="metric-label">Default Values</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.vibe_score_stats?.calculation_failures || 0}</div>
                <div class="metric-label">Calculation Failures</div>
            </div>
        </div>
        
        ${tickerDetailsHTML}
    `;
}

// Ticker Analysis Page
async function loadTickers() {
    try {
        // Get the latest report to extract ticker details
        const response = await fetch(`https://api.vibebullish.com/api/data-pipeline/reports?limit=1&t=${Date.now()}`);
        const data = await response.json();
        
        if (data.reports && data.reports.length > 0) {
            const rawTickers = data.reports[0].ticker_details || [];
            
            // Filter out invalid/test tickers
            allTickers = rawTickers.filter(t => {
                // Exclude test tickers
                if (t.ticker === 'TEST' || t.ticker === 'FAKE' || t.ticker === 'INVALID') {
                    console.log(`⚠️ Filtered out test ticker: ${t.ticker}`);
                    return false;
                }
                
                // Exclude tickers with no valid price data
                if (!t.current_price || t.current_price === 0) {
                    console.log(`⚠️ Filtered out ticker with invalid price: ${t.ticker}`);
                    return false;
                }
                
                return true;
            });
            
            // DEBUG: Check if timeframe_data is present
            if (allTickers.length > 0) {
                const sample = allTickers[0];
                console.log(`🔍 DEBUG: Sample ticker ${sample.ticker} - timeframe_data exists: ${!!sample.timeframe_data}`);
                if (sample.timeframe_data) {
                    console.log(`🔍 DEBUG: Available timeframes:`, Object.keys(sample.timeframe_data));
                    if (sample.timeframe_data['1W']) {
                        console.log(`🔍 DEBUG: 1W data:`, sample.timeframe_data['1W']);
                    }
                }
            }
            
            filteredTickers = [...allTickers];
            
            // Debug logging
            console.log('Latest report ID:', data.reports[0].report_id);
            console.log('Total tickers loaded:', allTickers.length, `(${rawTickers.length - allTickers.length} filtered out)`);
            
            // Check AAPL specifically
            const aaplTicker = allTickers.find(t => t.ticker === 'AAPL');
            if (aaplTicker) {
                console.log('AAPL data:', {
                    ticker: aaplTicker.ticker,
                    ai_rating: aaplTicker.ai_rating,
                    has_breakdown: !!aaplTicker.ai_rating_breakdown,
                    breakdown_components: aaplTicker.ai_rating_breakdown ? Object.keys(aaplTicker.ai_rating_breakdown.components || {}) : null
                });
            }
            
            displayTickers();
        } else {
            document.getElementById('ticker-list').innerHTML = '<div class="error">No ticker data available</div>';
        }
    } catch (error) {
        console.error('Error loading tickers:', error);
        document.getElementById('ticker-list').innerHTML = '<div class="error">Failed to load ticker data</div>';
    }
}

function displayTickers() {
    if (filteredTickers.length === 0) {
        document.getElementById('ticker-list').innerHTML = '<div class="no-data">No tickers match the current filter</div>';
        return;
    }

    const tickersHTML = filteredTickers.map(ticker => `
        <div class="ticker-card">
            <div class="ticker-header">
                <h3>${ticker.ticker}</h3>
                <span class="status-badge ${ticker.status === 'success' ? 'status-success' : ticker.status === 'error' ? 'status-error' : 'status-warning'}">${ticker.status}</span>
            </div>
            <div class="ticker-metrics">
                <div class="metric">
                    <span class="label">Price:</span>
                    <span class="value">$${ticker.current_price?.toFixed(2) || 'N/A'}</span>
                </div>
                <div class="metric">
                    <span class="label">AI Rating:</span>
                    <span class="value">${ticker.ai_rating && ticker.ai_rating >= 0 ? (ticker.ai_rating * 100).toFixed(1) + '%' : 'N/A'}</span>
                </div>
                <div class="metric">
                    <span class="label">Volume:</span>
                    <span class="value">${ticker.volume ? (ticker.volume / 1000000).toFixed(1) + 'M' : 'N/A'}</span>
                </div>
            </div>
            <div class="ticker-strategy">
                <span class="strategy-label">Strategy:</span>
                <span class="strategy-badge ${getTradingStrategy(ticker).class}">${getTradingStrategy(ticker).label}</span>
                <span class="strategy-explanation">${getTradingStrategy(ticker).explanation}</span>
            </div>
            ${ticker.ai_rating_breakdown ? `
                <div class="ticker-breakdown">
                    <h4>Score Breakdown:</h4>
                    <div class="breakdown-grid">
                        ${Object.entries(ticker.ai_rating_breakdown.components || {}).map(([key, component]) => 
                            `<div class="breakdown-item">
                                <span class="breakdown-label">${key.replace(/_/g, ' ').toUpperCase()}:</span>
                                <span class="breakdown-value">${(component.score * 100).toFixed(1)}%</span>
                                <span class="breakdown-weight">(${(component.weight * 100).toFixed(0)}% weight)</span>
                            </div>`
                        ).join('')}
                    </div>
                </div>
            ` : ''}
            <div id="timeframes-${ticker.ticker}" class="timeframe-details-inline">
                <div class="timeframe-loading">Loading timeframes...</div>
            </div>
        </div>
    `).join('');
    
    document.getElementById('ticker-list').innerHTML = `<div class="ticker-grid">${tickersHTML}</div>`;
    
    // Auto-load timeframes for all visible tickers based on global selection
    filteredTickers.forEach(ticker => {
        loadTimeframeDataInline(ticker.ticker, currentTimeframe);
    });
}

async function filterTickers(filter) {
    currentFilter = filter;
    
    // Update active filter button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-ticker-filter="${filter}"]`).classList.add('active');
    
    // Clear strategy filter when using regular filters
    document.querySelectorAll('.strategy-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Apply filter
    switch (filter) {
        case 'all':
            filteredTickers = [...allTickers];
            break;
        case 'high-ai-rating':
            filteredTickers = allTickers.filter(t => t.ai_rating && t.ai_rating > 0.5);
            break;
        case 'buy-targets':
            filteredTickers = allTickers.filter(t => t.buy_target && t.current_price && t.current_price <= t.buy_target);
            break;
        case 'high-upside':
            // Filter by upside > 20%
            // Note: When a specific timeframe is selected, the data already includes timeframe-specific upside
            filteredTickers = allTickers.filter(t => t.upside_percent && t.upside_percent > 20);
            break;
    }
    
    // Apply current sort
    sortTickers(currentSort);
}

async function filterByStrategy(strategy) {
    // Update active strategy filter button
    document.querySelectorAll('.strategy-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-strategy-filter="${strategy}"]`).classList.add('active');
    
    // Clear regular filter when using strategy filter
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector('[data-ticker-filter="all"]').classList.add('active');
    
    // Filter by strategy
    filteredTickers = allTickers.filter(ticker => {
        const tickerStrategy = getTradingStrategy(ticker);
        return tickerStrategy.class === `strategy-${strategy}`;
    });
    
    // Apply current sort
    sortTickers(currentSort);
}

function sortTickers(sortBy) {
    console.log(`📊 sortTickers called: sortBy=${sortBy}, currentTimeframe=${currentTimeframe}, filteredTickers.length=${filteredTickers.length}`);
    currentSort = sortBy;
    
    // DEBUG: Log sample before sort
    if (currentTimeframe !== 'all' && filteredTickers.length > 0) {
        const sample = filteredTickers[0];
        console.log(`🔍 DEBUG before sort: ${sample.ticker} - timeframe_data exists: ${!!sample.timeframe_data}`);
        if (sample.timeframe_data && sample.timeframe_data[currentTimeframe]) {
            console.log(`🔍 DEBUG: ${currentTimeframe} data:`, sample.timeframe_data[currentTimeframe]);
        }
    }
    
    // INSTANT SORTING: Use pre-loaded timeframe_data from report - no API calls needed!
    filteredTickers.sort((a, b) => {
        // For timeframe-specific sorting, use the timeframe_data map
        if (currentTimeframe !== 'all' && (sortBy === 'upside' || sortBy === 'price')) {
            const aData = a.timeframe_data && a.timeframe_data[currentTimeframe];
            const bData = b.timeframe_data && b.timeframe_data[currentTimeframe];
            
            if (sortBy === 'upside') {
                const aUpside = aData?.upside || 0;
                const bUpside = bData?.upside || 0;
                return bUpside - aUpside;
            } else if (sortBy === 'price') {
                const aPrice = aData?.sell_target || 0;
                const bPrice = bData?.sell_target || 0;
                return bPrice - aPrice;
            }
        }
        
        // Normal sorting (no timeframe filter)
        switch (sortBy) {
            case 'ticker':
                return a.ticker.localeCompare(b.ticker);
            case 'ai-rating':
                return (b.ai_rating || 0) - (a.ai_rating || 0);
            case 'upside':
                return (b.upside_percent || 0) - (a.upside_percent || 0);
            case 'price':
                return (b.current_price || 0) - (a.current_price || 0);
            case 'volume':
                return (b.volume || 0) - (a.volume || 0);
            default:
                return 0;
        }
    });
    
    // DEBUG: Log top 5 after sort
    if (currentTimeframe !== 'all' && sortBy === 'upside' && filteredTickers.length > 0) {
        console.log(`🔍 DEBUG after sort - Top 5 by ${sortBy} for ${currentTimeframe}:`);
        filteredTickers.slice(0, 5).forEach((t, i) => {
            const data = t.timeframe_data && t.timeframe_data[currentTimeframe];
            console.log(`  ${i+1}. ${t.ticker}: upside=${data?.upside || 'N/A'}`);
        });
    }
    
    displayTickers();
    console.log(`✅ Sorted ${filteredTickers.length} tickers by ${sortBy}${currentTimeframe !== 'all' ? ` for ${currentTimeframe}` : ''} - INSTANT (no API call)`);
}

async function searchTickers(query) {
    if (!query.trim()) {
        await filterTickers(currentFilter);
        return;
    }
    
    const searchTerm = query.toLowerCase();
    filteredTickers = allTickers.filter(ticker => 
        ticker.ticker.toLowerCase().includes(searchTerm)
    );
    
    sortTickers(currentSort);
}

// Schedule Page
async function loadSchedule() {
    try {
        const [statusResponse, statsResponse] = await Promise.all([
            fetch('https://api.vibebullish.com/api/data-ingestion/status'),
            fetch('https://api.vibebullish.com/api/data-ingestion/stats')
        ]);
        
        const statusData = await statusResponse.json();
        const statsData = await statsResponse.json();
        
        displaySchedule(statusData.status, statsData.stats);
    } catch (error) {
        console.error('Error loading schedule:', error);
        document.getElementById('schedule-content').innerHTML = '<div class="error">Failed to load schedule information</div>';
    }
}

function displaySchedule(status, stats) {
    const nextRun = new Date(status.next_run);
    const lastIngestion = new Date(stats.last_ingestion);
    const now = new Date();
    
    const timeUntilNext = nextRun - now;
    const timeSinceLast = now - lastIngestion;
    
    const formatTime = (ms) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((ms % (1000 * 60)) / 1000);
        
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    };
    
    const statusClass = status.is_running ? 'status-success' : 'status-error';
    const scheduleStatusClass = stats.schedule_status === 'active' ? 'status-success' : 'status-warning';
    
    document.getElementById('schedule-content').innerHTML = `
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">
                    <span class="status-badge ${statusClass}">${status.is_running ? 'Running' : 'Stopped'}</span>
                </div>
                <div class="metric-label">Job Status</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${status.interval_hours}h</div>
                <div class="metric-label">Interval</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${status.tickers}</div>
                <div class="metric-label">Active Tickers</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">
                    <span class="status-badge ${scheduleStatusClass}">${stats.schedule_status}</span>
                </div>
                <div class="metric-label">Schedule Status</div>
            </div>
        </div>
        
        <h3>Next Run Information</h3>
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">${nextRun.toLocaleString()}</div>
                <div class="metric-label">Next Run Time</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${formatTime(timeUntilNext)}</div>
                <div class="metric-label">Time Until Next</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${lastIngestion.toLocaleString()}</div>
                <div class="metric-label">Last Ingestion</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${formatTime(timeSinceLast)}</div>
                <div class="metric-label">Time Since Last</div>
            </div>
        </div>
        
        <h3>Performance Statistics</h3>
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">${(stats.success_rate * 100).toFixed(1)}%</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${stats.avg_duration}</div>
                <div class="metric-label">Avg Duration</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${stats.total_runs_today}</div>
                <div class="metric-label">Runs Today</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${stats.avg_tickers_per_run}</div>
                <div class="metric-label">Avg Tickers/Run</div>
            </div>
        </div>
        
        <h3>Schedule Details</h3>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 20px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div>
                    <h4>Configuration</h4>
                    <p><strong>Schedule Type:</strong> ${status.schedule_type}</p>
                    <p><strong>Dynamic Interval:</strong> ${status.dynamic ? 'Yes' : 'No'}</p>
                    <p><strong>Interval:</strong> ${status.interval}</p>
                </div>
                <div>
                    <h4>Recent Activity</h4>
                    <p><strong>Total Snapshots:</strong> ${stats.total_snapshots}</p>
                    <p><strong>Active Tickers:</strong> ${stats.active_tickers}</p>
                    <p><strong>Time Since Last:</strong> ${stats.time_since_last}</p>
                </div>
            </div>
        </div>
    `;
}

// Toggle and load multi-timeframe price targets
async function toggleTimeframes(ticker) {
    const detailsDiv = document.getElementById(`timeframes-${ticker}`);
    const button = event.target;
    
    if (detailsDiv.style.display === 'none') {
        // Load data if not loaded yet, using the global currentTimeframe
        if (!detailsDiv.dataset.loaded) {
            await loadTimeframeData(ticker, currentTimeframe);
            detailsDiv.dataset.loaded = 'true';
        }
        detailsDiv.style.display = 'block';
        button.textContent = '📊 Hide Timeframes';
    } else {
        detailsDiv.style.display = 'none';
        button.textContent = '📊 View All Timeframes (6)';
    }
}

async function loadTimeframeData(ticker, selectedHorizon) {
    // Use global currentTimeframe if no horizon specified
    if (!selectedHorizon) {
        selectedHorizon = currentTimeframe;
    }
    const detailsDiv = document.getElementById(`timeframes-${ticker}`);
    
    try {
        const response = await fetch(`https://api.vibebullish.com/api/stocks/${ticker}/price-targets/all`);
        const data = await response.json();
        
        // Store data for filtering
        if (!detailsDiv.dataset.cachedData) {
            detailsDiv.dataset.cachedData = JSON.stringify(data);
        }
        
        // Sort timeframes in order
        const timeframeOrder = ['1D', '1W', '1M', '6M', '12M', '>12M'];
        let sortedTargets = data.trading_agents.sort((a, b) => {
            return timeframeOrder.indexOf(a.time_horizon) - timeframeOrder.indexOf(b.time_horizon);
        });
        
        // Filter if specific horizon selected
        if (selectedHorizon !== 'all') {
            sortedTargets = sortedTargets.filter(t => t.time_horizon === selectedHorizon);
        }
        
        const icons = {
            '1D': '⚡',
            '1W': '📅',
            '1M': '📆',
            '6M': '📊',
            '12M': '📈',
            '>12M': '🚀'
        };
        
        const labels = {
            '1D': '1 Day',
            '1W': '1 Week',
            '1M': '1 Month',
            '6M': '6 Months',
            '12M': '12 Months',
            '>12M': '12+ Months'
        };
        
        // Add timeframe filter buttons
        let html = `
            <div class="timeframe-filter-bar">
                <button class="timeframe-filter-btn ${selectedHorizon === 'all' ? 'active' : ''}" onclick="filterTimeframe('${ticker}', 'all')">📊 All</button>
                <button class="timeframe-filter-btn ${selectedHorizon === '1D' ? 'active' : ''}" onclick="filterTimeframe('${ticker}', '1D')">⚡ 1D</button>
                <button class="timeframe-filter-btn ${selectedHorizon === '1W' ? 'active' : ''}" onclick="filterTimeframe('${ticker}', '1W')">📅 1W</button>
                <button class="timeframe-filter-btn ${selectedHorizon === '1M' ? 'active' : ''}" onclick="filterTimeframe('${ticker}', '1M')">📆 1M</button>
                <button class="timeframe-filter-btn ${selectedHorizon === '6M' ? 'active' : ''}" onclick="filterTimeframe('${ticker}', '6M')">📊 6M</button>
                <button class="timeframe-filter-btn ${selectedHorizon === '12M' ? 'active' : ''}" onclick="filterTimeframe('${ticker}', '12M')">📈 12M</button>
                <button class="timeframe-filter-btn ${selectedHorizon === '>12M' ? 'active' : ''}" onclick="filterTimeframe('${ticker}', '>12M')">🚀 >12M</button>
            </div>
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
        `;
        
        sortedTargets.forEach(target => {
            const upsideClass = target.upside_percent >= 0 ? 'upside-positive' : 'upside-negative';
            html += `
                <tr>
                    <td>${icons[target.time_horizon]} ${labels[target.time_horizon]}</td>
                    <td>$${target.buy_target.toFixed(2)}</td>
                    <td>$${target.sell_target.toFixed(2)}</td>
                    <td class="${upsideClass}">${target.upside_percent >= 0 ? '+' : ''}${target.upside_percent.toFixed(2)}%</td>
                    <td>${(target.confidence * 100).toFixed(0)}%</td>
                </tr>
            `;
        });
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        // Add LightGBM section if available
        if (data.lightgbm && data.lightgbm.predicted_price_1d) {
            html += `
                <div class="timeframe-section">
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
                                <td>$${data.lightgbm.predicted_price_1d.toFixed(2)}</td>
                                <td class="${((data.lightgbm.predicted_price_1d - data.current_price) / data.current_price * 100) >= 0 ? 'upside-positive' : 'upside-negative'}">
                                    ${((data.lightgbm.predicted_price_1d - data.current_price) / data.current_price * 100).toFixed(2)}%
                                </td>
                            </tr>
                            <tr>
                                <td>5 Days</td>
                                <td>$${data.lightgbm.predicted_price_5d.toFixed(2)}</td>
                                <td class="${((data.lightgbm.predicted_price_5d - data.current_price) / data.current_price * 100) >= 0 ? 'upside-positive' : 'upside-negative'}">
                                    ${((data.lightgbm.predicted_price_5d - data.current_price) / data.current_price * 100).toFixed(2)}%
                                </td>
                            </tr>
                            <tr>
                                <td>20 Days</td>
                                <td>$${data.lightgbm.predicted_price_20d.toFixed(2)}</td>
                                <td class="${((data.lightgbm.predicted_price_20d - data.current_price) / data.current_price * 100) >= 0 ? 'upside-positive' : 'upside-negative'}">
                                    ${((data.lightgbm.predicted_price_20d - data.current_price) / data.current_price * 100).toFixed(2)}%
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        detailsDiv.innerHTML = html;
    } catch (error) {
        console.error(`Error loading timeframes for ${ticker}:`, error);
        detailsDiv.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #dc2626;">
                ❌ Failed to load timeframe data: ${error.message}
            </div>
        `;
    }
}

// Global timeframe filter (applies to all tickers)
async function filterByTimeframe(horizon) {
    currentTimeframe = horizon;
    
    // Update active button state
    document.querySelectorAll('.timeframe-filter-buttons .timeframe-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-timeframe') === horizon) {
            btn.classList.add('active');
        }
    });
    
    // Enable/disable sort buttons based on timeframe selection
    const sortButtons = document.querySelectorAll('.sort-btn');
    if (horizon === 'all') {
        // Disable upside and price sorting when "All" is selected
        sortButtons.forEach(btn => {
            const sortType = btn.getAttribute('data-sort');
            if (sortType === 'upside' || sortType === 'price') {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
        });
        // Switch to AI Rating sort
        currentSort = 'ai-rating';
        sortButtons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-sort') === 'ai-rating') {
                btn.classList.add('active');
            }
        });
    } else {
        // Enable all sort buttons
        sortButtons.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            console.log(`✅ Enabled sort button: ${btn.getAttribute('data-sort')}`);
        });
    }
    
    // Re-sort and reload all visible tickers with the new timeframe
    console.log(`🔄 Re-sorting with current sort: ${currentSort}, timeframe: ${horizon}`);
    sortTickers(currentSort);
    
    filteredTickers.forEach(ticker => {
        loadTimeframeDataInline(ticker.ticker, horizon);
    });
}

// Load timeframe data inline (no expand/collapse, always visible)
async function loadTimeframeDataInline(ticker, selectedHorizon) {
    const detailsDiv = document.getElementById(`timeframes-${ticker}`);
    if (!detailsDiv) return;
    
    // Use global currentTimeframe if no horizon specified
    if (!selectedHorizon) {
        selectedHorizon = currentTimeframe;
    }
    
    detailsDiv.style.display = 'block';
    detailsDiv.innerHTML = '<div class="timeframe-loading">Loading...</div>';
    
    try {
        const response = await fetch(`https://api.vibebullish.com/api/stocks/${ticker}/price-targets/all`);
        const data = await response.json();
        
        const icons = {
            '1D': '⚡',
            '1W': '📅',
            '1M': '📆',
            '6M': '📊',
            '12M': '📈',
            '>12M': '🚀'
        };
        
        const labels = {
            '1D': '1 Day',
            '1W': '1 Week',
            '1M': '1 Month',
            '6M': '6 Months',
            '12M': '12 Months',
            '>12M': '12+ Months'
        };
        
        // If "All" selected, show all 6 timeframes in a table
        if (selectedHorizon === 'all') {
            const timeframeOrder = ['1D', '1W', '1M', '6M', '12M', '>12M'];
            const sortedTargets = data.trading_agents.sort((a, b) => {
                return timeframeOrder.indexOf(a.time_horizon) - timeframeOrder.indexOf(b.time_horizon);
            });
            
            let tableHTML = `
                <div class="timeframe-inline-content">
                    <div class="timeframe-inline-header">All Timeframe Predictions</div>
                    <table class="timeframe-compact-table">
                        <thead>
                            <tr>
                                <th>Horizon</th>
                                <th>Buy</th>
                                <th>Sell</th>
                                <th>Upside</th>
                                <th>Conf.</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            sortedTargets.forEach(target => {
                const upsideClass = target.upside_percent >= 0 ? 'upside-positive' : 'upside-negative';
                tableHTML += `
                    <tr>
                        <td>${icons[target.time_horizon]} ${labels[target.time_horizon]}</td>
                        <td>$${target.buy_target.toFixed(2)}</td>
                        <td>$${target.sell_target.toFixed(2)}</td>
                        <td class="${upsideClass}">${target.upside_percent >= 0 ? '+' : ''}${target.upside_percent.toFixed(1)}%</td>
                        <td>${(target.confidence * 100).toFixed(0)}%</td>
                    </tr>
                `;
            });
            
            tableHTML += `
                        </tbody>
                    </table>
                </div>
            `;
            
            detailsDiv.innerHTML = tableHTML;
            return;
        }
        
        // Otherwise, show the specific selected timeframe
        const target = data.trading_agents.find(t => t.time_horizon === selectedHorizon);
        
        if (!target) {
            detailsDiv.innerHTML = '<div class="timeframe-no-data">No data for this timeframe</div>';
            return;
        }
        
        // Store the timeframe-specific data on the ticker object for sorting
        const tickerObj = filteredTickers.find(t => t.ticker === ticker) || allTickers.find(t => t.ticker === ticker);
        if (tickerObj) {
            tickerObj._timeframeUpside = target.upside_percent;
            tickerObj._timeframeSellTarget = target.sell_target;
            tickerObj._timeframeBuyTarget = target.buy_target;
            tickerObj._timeframeConfidence = target.confidence;
            tickerObj._lastFetchedTimeframe = selectedHorizon;
        }
        
        const upsideClass = target.upside_percent >= 0 ? 'upside-positive' : 'upside-negative';
        
        detailsDiv.innerHTML = `
            <div class="timeframe-inline-content">
                <div class="timeframe-inline-header">
                    ${icons[selectedHorizon]} ${labels[selectedHorizon]} Prediction
                </div>
                <div class="timeframe-inline-grid">
                    <div class="timeframe-inline-item">
                        <span class="timeframe-inline-label">Buy Target:</span>
                        <span class="timeframe-inline-value">$${target.buy_target.toFixed(2)}</span>
                    </div>
                    <div class="timeframe-inline-item">
                        <span class="timeframe-inline-label">Sell Target:</span>
                        <span class="timeframe-inline-value">$${target.sell_target.toFixed(2)}</span>
                    </div>
                    <div class="timeframe-inline-item">
                        <span class="timeframe-inline-label">Upside:</span>
                        <span class="timeframe-inline-value ${upsideClass}">${target.upside_percent >= 0 ? '+' : ''}${target.upside_percent.toFixed(2)}%</span>
                    </div>
                    <div class="timeframe-inline-item">
                        <span class="timeframe-inline-label">Confidence:</span>
                        <span class="timeframe-inline-value">${(target.confidence * 100).toFixed(0)}%</span>
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error(`Error loading timeframe for ${ticker}:`, error);
        detailsDiv.innerHTML = '<div class="timeframe-error">Failed to load timeframe data</div>';
    }
}

// Filter timeframes (for per-ticker switching - kept for compatibility)
function filterTimeframe(ticker, horizon) {
    loadTimeframeData(ticker, horizon);
}

// Make functions globally available
window.loadTickers = loadTickers;
window.filterTickers = filterTickers;
window.sortTickers = sortTickers;
window.searchTickers = searchTickers;
window.showPage = showPage;
window.showReportDetail = showReportDetail;
window.changePage = changePage;
window.loadSchedule = loadSchedule;
window.toggleTimeframes = toggleTimeframes;
window.filterTimeframe = filterTimeframe;
window.filterByTimeframe = filterByTimeframe;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadOverview();
    
    // Add event listeners for navigation
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('nav-link')) {
            e.preventDefault();
            const pageId = e.target.getAttribute('data-page');
            showPage(pageId);
        } else if (e.target.classList.contains('filter-btn')) {
            const filter = e.target.getAttribute('data-ticker-filter');
            await filterTickers(filter);
        } else if (e.target.classList.contains('strategy-filter-btn')) {
            const strategyFilter = e.target.getAttribute('data-strategy-filter');
            await filterByStrategy(strategyFilter);
        } else if (e.target.classList.contains('sort-btn')) {
            const sort = e.target.getAttribute('data-sort');
            console.log(`🖱️ Sort button clicked: ${sort}, disabled=${e.target.disabled}, currentTimeframe=${currentTimeframe}`);
            
            // Check if button is actually disabled
            if (e.target.disabled) {
                console.warn(`⚠️ Button is disabled, ignoring click`);
                return;
            }
            
            sortTickers(sort);
            
            // Update active sort button
            document.querySelectorAll('.sort-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            e.target.classList.add('active');
        }
    });
    
    const searchBox = document.getElementById('ticker-search');
    if (searchBox) {
        searchBox.addEventListener('input', (e) => {
            searchTickers(e.target.value);
        });
    }
});
// Force deployment Wed Sep  3 14:51:04 PDT 2025
