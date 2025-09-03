// Dashboard JavaScript
const API_BASE = 'https://moodvestor-backend-production.up.railway.app/api/data-pipeline';
let currentReports = [];
let currentTickers = [];
let currentPage = 1;
const reportsPerPage = 10;

// Ticker Analysis Page
let allTickers = [];
let filteredTickers = [];
let currentSort = 'ticker';
let currentFilter = 'all';

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
    }
}

// Overview Page
async function loadOverview() {
    try {
        const response = await fetch(`${API_BASE}/reports?limit=1`);
        const data = await response.json();
        
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
                <div class="metric-value">${report.summary.success_rate}%</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.total_tickers_processed}</div>
                <div class="metric-label">Tickers Processed</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.data_quality_score}%</div>
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
                <div class="metric-label">Vibe Scores Calculated</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${(vibeStats.average_score || 0).toFixed(3)}</div>
                <div class="metric-label">Avg Vibe Score</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${tickerCount}</div>
                <div class="metric-label">Detailed Tickers</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.processing_time}</div>
                <div class="metric-label">Processing Time</div>
            </div>
        </div>
    `;
}

// Load schedule summary for overview
async function loadScheduleSummary() {
    try {
        const response = await fetch('https://moodvestor-backend-production.up.railway.app/api/data-ingestion/status');
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
        const response = await fetch(`${API_BASE}/reports?limit=50`);
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
                        <div class="summary-value">${report.summary.success_rate}%</div>
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
                                <span class="detail-label">Vibe Score:</span>
                                <span class="detail-value">${ticker.vibe_score ? ticker.vibe_score.toFixed(3) : 'N/A'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Buy Target:</span>
                                <span class="detail-value">${ticker.buy_target ? '$' + ticker.buy_target.toFixed(2) : 'N/A'}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">Sell Target:</span>
                                <span class="detail-value">${ticker.sell_target ? '$' + ticker.sell_target.toFixed(2) : 'N/A'}</span>
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
                <div class="metric-value">${report.summary.success_rate}%</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.total_tickers_processed}</div>
                <div class="metric-label">Tickers Processed</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${report.summary.data_quality_score}%</div>
                <div class="metric-label">Data Quality</div>
            </div>
            <div class="metric-card">
                <div class="metric-value"><span class="status-badge ${statusClass}">${report.status}</span></div>
                <div class="metric-label">Status</div>
            </div>
        </div>
        
        <h3>Vibe Score Statistics</h3>
        <div class="metric-grid">
            <div class="metric-card">
                <div class="metric-value">${report.vibe_score_stats?.total_calculated || 0}</div>
                <div class="metric-label">Total Calculated</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${(report.vibe_score_stats?.average_score || 0).toFixed(3)}</div>
                <div class="metric-label">Average Score</div>
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
        const response = await fetch('https://moodvestor-backend-production.up.railway.app/api/data-pipeline/reports?limit=1');
        const data = await response.json();
        
        if (data.reports && data.reports.length > 0) {
            allTickers = data.reports[0].ticker_details || [];
            filteredTickers = [...allTickers];
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
                <span class="status-badge ${ticker.status === 'success' ? 'status-success' : 'status-warning'}">${ticker.status}</span>
            </div>
            <div class="ticker-metrics">
                <div class="metric">
                    <span class="label">Price:</span>
                    <span class="value">$${ticker.current_price?.toFixed(2) || 'N/A'}</span>
                </div>
                <div class="metric">
                    <span class="label">Vibe Score:</span>
                    <span class="value">${ticker.vibe_score ? (ticker.vibe_score * 100).toFixed(1) + '%' : 'N/A'}</span>
                </div>
                <div class="metric">
                    <span class="label">Upside:</span>
                    <span class="value">${ticker.upside_percent ? ticker.upside_percent.toFixed(1) + '%' : 'N/A'}</span>
                </div>
                <div class="metric">
                    <span class="label">Buy Target:</span>
                    <span class="value">${ticker.buy_target ? '$' + ticker.buy_target.toFixed(2) : 'N/A'}</span>
                </div>
                <div class="metric">
                    <span class="label">Sell Target:</span>
                    <span class="value">${ticker.sell_target ? '$' + ticker.sell_target.toFixed(2) : 'N/A'}</span>
                </div>
                <div class="metric">
                    <span class="label">Volume:</span>
                    <span class="value">${ticker.volume ? (ticker.volume / 1000000).toFixed(1) + 'M' : 'N/A'}</span>
                </div>
            </div>
        </div>
    `).join('');
    
    document.getElementById('ticker-list').innerHTML = `<div class="ticker-grid">${tickersHTML}</div>`;
}

function filterTickers(filter) {
    currentFilter = filter;
    
    // Update active filter button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-ticker-filter="${filter}"]`).classList.add('active');
    
    // Apply filter
    switch (filter) {
        case 'all':
            filteredTickers = [...allTickers];
            break;
        case 'high-vibe':
            filteredTickers = allTickers.filter(t => t.vibe_score && t.vibe_score > 0.5);
            break;
        case 'buy-targets':
            filteredTickers = allTickers.filter(t => t.buy_target && t.current_price && t.current_price <= t.buy_target);
            break;
        case 'high-upside':
            filteredTickers = allTickers.filter(t => t.upside_percent && t.upside_percent > 20);
            break;
    }
    
    // Apply current sort
    sortTickers(currentSort);
}

function sortTickers(sortBy) {
    currentSort = sortBy;
    
    filteredTickers.sort((a, b) => {
        switch (sortBy) {
            case 'ticker':
                return a.ticker.localeCompare(b.ticker);
            case 'vibe-score':
                return (b.vibe_score || 0) - (a.vibe_score || 0);
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
    
    displayTickers();
}

function searchTickers(query) {
    if (!query.trim()) {
        filterTickers(currentFilter);
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
            fetch('https://moodvestor-backend-production.up.railway.app/api/data-ingestion/status'),
            fetch('https://moodvestor-backend-production.up.railway.app/api/data-ingestion/stats')
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

// Make functions globally available
window.loadTickers = loadTickers;
window.filterTickers = filterTickers;
window.sortTickers = sortTickers;
window.searchTickers = searchTickers;
window.showPage = showPage;
window.showReportDetail = showReportDetail;
window.changePage = changePage;
window.loadSchedule = loadSchedule;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadOverview();
    
    // Add event listeners for navigation
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('nav-link')) {
            e.preventDefault();
            const pageId = e.target.getAttribute('data-page');
            showPage(pageId);
        } else if (e.target.classList.contains('filter-btn')) {
            const filter = e.target.getAttribute('data-ticker-filter');
            filterTickers(filter);
        } else if (e.target.classList.contains('sort-btn')) {
            const sort = e.target.getAttribute('data-sort');
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
