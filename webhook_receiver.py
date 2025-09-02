#!/usr/bin/env python3
"""
Simple webhook receiver for Moodvestor Data Pipeline Reports
This can be used to receive reports and forward them to Slack, Discord, or other services.
"""

import json
import logging
import os
from datetime import datetime
from flask import Flask, request, jsonify
import requests

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration
SLACK_WEBHOOK_URL = os.getenv('SLACK_WEBHOOK_URL')
DISCORD_WEBHOOK_URL = os.getenv('DISCORD_WEBHOOK_URL')
BACKEND_URL = os.getenv('BACKEND_URL', 'https://moodvestor-backend-production.up.railway.app')

@app.route('/webhook/data-pipeline', methods=['POST'])
def receive_data_pipeline_report():
    """Receive data pipeline reports and forward to configured services"""
    try:
        report = request.get_json()
        
        if not report:
            return jsonify({'error': 'No JSON data received'}), 400
        
        logger.info(f"Received data pipeline report: {report.get('report_id', 'unknown')}")
        
        # Log the report
        log_report(report)
        
        # Forward to Slack if configured
        if SLACK_WEBHOOK_URL:
            send_to_slack(report)
        
        # Forward to Discord if configured
        if DISCORD_WEBHOOK_URL:
            send_to_discord(report)
        
        # Store in local file for debugging
        store_report_locally(report)
        
        return jsonify({'status': 'received', 'report_id': report.get('report_id')})
        
    except Exception as e:
        logger.error(f"Error processing webhook: {e}")
        return jsonify({'error': str(e)}), 500

def log_report(report):
    """Log the report details"""
    report_id = report.get('report_id', 'unknown')
    status = report.get('status', 'unknown')
    report_type = report.get('report_type', 'unknown')
    
    logger.info(f"Report {report_id}: {report_type} - {status}")
    
    # Log critical issues
    summary = report.get('summary', {})
    critical_issues = summary.get('critical_issues', 0)
    if critical_issues > 0:
        logger.warning(f"🚨 CRITICAL: {critical_issues} critical issues in report {report_id}")
    
    # Log vibe score issues
    vibe_stats = report.get('vibe_score_stats', {})
    default_values = vibe_stats.get('default_values_used', 0)
    total_calculated = vibe_stats.get('total_calculated', 0)
    if default_values > 0 and total_calculated > 0:
        percentage = (default_values / total_calculated) * 100
        logger.warning(f"⚠️ VIBE SCORE ISSUE: {default_values}/{total_calculated} scores are default values ({percentage:.1f}%)")

def send_to_slack(report):
    """Send report to Slack"""
    try:
        report_id = report.get('report_id', 'unknown')
        status = report.get('status', 'unknown')
        summary = report.get('summary', {})
        
        # Create Slack message
        color = {
            'success': 'good',
            'warning': 'warning', 
            'error': 'danger'
        }.get(status, 'good')
        
        message = {
            "attachments": [
                {
                    "color": color,
                    "title": f"Data Pipeline Report: {report_id}",
                    "fields": [
                        {
                            "title": "Status",
                            "value": status.upper(),
                            "short": True
                        },
                        {
                            "title": "Type",
                            "value": report.get('report_type', 'unknown'),
                            "short": True
                        },
                        {
                            "title": "Tickers Processed",
                            "value": str(summary.get('total_tickers_processed', 0)),
                            "short": True
                        },
                        {
                            "title": "Success Rate",
                            "value": f"{summary.get('success_rate', 0):.1f}%",
                            "short": True
                        },
                        {
                            "title": "Critical Issues",
                            "value": str(summary.get('critical_issues', 0)),
                            "short": True
                        },
                        {
                            "title": "Data Quality",
                            "value": f"{summary.get('data_quality_score', 0):.1f}%",
                            "short": True
                        }
                    ],
                    "footer": "Moodvestor Data Pipeline",
                    "ts": int(datetime.now().timestamp())
                }
            ]
        }
        
        # Add vibe score information if available
        vibe_stats = report.get('vibe_score_stats', {})
        if vibe_stats:
            default_values = vibe_stats.get('default_values_used', 0)
            total_calculated = vibe_stats.get('total_calculated', 0)
            if default_values > 0:
                message["attachments"][0]["fields"].append({
                    "title": "Vibe Score Issue",
                    "value": f"{default_values}/{total_calculated} default values",
                    "short": True
                })
        
        # Add recommendations if available
        recommendations = report.get('recommendations', [])
        if recommendations:
            message["attachments"][0]["fields"].append({
                "title": "Recommendations",
                "value": "\n".join(recommendations[:3]),  # Show first 3 recommendations
                "short": False
            })
        
        response = requests.post(SLACK_WEBHOOK_URL, json=message, timeout=10)
        response.raise_for_status()
        logger.info("Report sent to Slack successfully")
        
    except Exception as e:
        logger.error(f"Failed to send to Slack: {e}")

def send_to_discord(report):
    """Send report to Discord"""
    try:
        report_id = report.get('report_id', 'unknown')
        status = report.get('status', 'unknown')
        summary = report.get('summary', {})
        
        # Create Discord embed
        color = {
            'success': 0x28a745,  # Green
            'warning': 0xffc107,  # Yellow
            'error': 0xdc3545     # Red
        }.get(status, 0x28a745)
        
        embed = {
            "title": f"Data Pipeline Report: {report_id}",
            "color": color,
            "fields": [
                {
                    "name": "Status",
                    "value": status.upper(),
                    "inline": True
                },
                {
                    "name": "Type",
                    "value": report.get('report_type', 'unknown'),
                    "inline": True
                },
                {
                    "name": "Tickers Processed",
                    "value": str(summary.get('total_tickers_processed', 0)),
                    "inline": True
                },
                {
                    "name": "Success Rate",
                    "value": f"{summary.get('success_rate', 0):.1f}%",
                    "inline": True
                },
                {
                    "name": "Critical Issues",
                    "value": str(summary.get('critical_issues', 0)),
                    "inline": True
                },
                {
                    "name": "Data Quality",
                    "value": f"{summary.get('data_quality_score', 0):.1f}%",
                    "inline": True
                }
            ],
            "footer": {
                "text": "Moodvestor Data Pipeline"
            },
            "timestamp": datetime.now().isoformat()
        }
        
        # Add vibe score information if available
        vibe_stats = report.get('vibe_score_stats', {})
        if vibe_stats:
            default_values = vibe_stats.get('default_values_used', 0)
            total_calculated = vibe_stats.get('total_calculated', 0)
            if default_values > 0:
                embed["fields"].append({
                    "name": "Vibe Score Issue",
                    "value": f"{default_values}/{total_calculated} default values",
                    "inline": True
                })
        
        message = {
            "embeds": [embed]
        }
        
        response = requests.post(DISCORD_WEBHOOK_URL, json=message, timeout=10)
        response.raise_for_status()
        logger.info("Report sent to Discord successfully")
        
    except Exception as e:
        logger.error(f"Failed to send to Discord: {e}")

def store_report_locally(report):
    """Store report locally for debugging"""
    try:
        os.makedirs('reports', exist_ok=True)
        
        report_id = report.get('report_id', 'unknown')
        filename = f"reports/{report_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        with open(filename, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        logger.info(f"Report stored locally: {filename}")
        
    except Exception as e:
        logger.error(f"Failed to store report locally: {e}")

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

@app.route('/dashboard', methods=['GET'])
def dashboard():
    """Simple dashboard page"""
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Moodvestor Webhook Receiver</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
            .success { background: #d4edda; color: #155724; }
            .info { background: #d1ecf1; color: #0c5460; }
        </style>
    </head>
    <body>
        <h1>🚀 Moodvestor Webhook Receiver</h1>
        <div class="status success">✅ Webhook receiver is running</div>
        <div class="status info">
            <h3>Configuration:</h3>
            <ul>
                <li>Slack Webhook: {'✅ Configured' if SLACK_WEBHOOK_URL else '❌ Not configured'}</li>
                <li>Discord Webhook: {'✅ Configured' if DISCORD_WEBHOOK_URL else '❌ Not configured'}</li>
                <li>Backend URL: {BACKEND_URL}</li>
            </ul>
        </div>
        <h3>Endpoints:</h3>
        <ul>
            <li><code>POST /webhook/data-pipeline</code> - Receive data pipeline reports</li>
            <li><code>GET /health</code> - Health check</li>
            <li><code>GET /dashboard</code> - This page</li>
        </ul>
        <h3>Recent Reports:</h3>
        <p>Check the <code>reports/</code> directory for stored reports.</p>
    </body>
    </html>
    """

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
