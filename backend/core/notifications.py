import os
import json
from datetime import datetime

# Resolve directories
script_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(script_dir, ".."))
LOG_FILE = os.path.join(backend_dir, "data", "email_notifications.log")
SETTINGS_FILE = os.path.join(backend_dir, "data", "settings.json")

MAX_BYTES = 50 * 1024  # 50 KB rotation limit for testing
BACKUP_COUNT = 3

def get_recipient_email():
    """Reads the farmer email configuration from settings.json."""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                data = json.load(f)
                if data.get("notifications_enabled", True):
                    return data.get("email", "farmer@example.com")
        except Exception:
            pass
    return "farmer@example.com"

def rotate_logs():
    """Implements log file rotation: rolls log file if it exceeds MAX_BYTES."""
    if not os.path.exists(LOG_FILE):
        return
        
    if os.path.getsize(LOG_FILE) < MAX_BYTES:
        return
        
    print(f"[LOG ROTATION] Log file size exceeds cap. Rotating {LOG_FILE}...")
    
    # Rotate existing backups: log.2 -> log.3, log.1 -> log.2
    for i in range(BACKUP_COUNT - 1, 0, -1):
        src = f"{LOG_FILE}.{i}"
        dst = f"{LOG_FILE}.{i+1}"
        if os.path.exists(src):
            if os.path.exists(dst):
                os.remove(dst)
            os.rename(src, dst)
            
    # Rename active log to log.1
    dst = f"{LOG_FILE}.1"
    if os.path.exists(dst):
        os.remove(dst)
    os.rename(LOG_FILE, dst)
    print(f"[LOG ROTATION] Rolled over active log to {dst}")

def send_email_notification(subject, body):
    """Sends a real email using SMTP if configured, otherwise falls back to logging."""
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    rotate_logs()
    
    # Load settings dynamically
    settings = {}
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                settings = json.load(f)
        except Exception:
            pass
            
    recipient = settings.get("email", "farmer@example.com")
    enabled = settings.get("notifications_enabled", True)
    
    if not enabled:
        print("[EMAIL] Notifications are disabled in settings.")
        return

    sender_email = settings.get("smtp_sender")
    app_password = settings.get("smtp_password")
    smtp_host = settings.get("smtp_host", "smtp.gmail.com")
    
    try:
        smtp_port = int(settings.get("smtp_port", 587))
    except (ValueError, TypeError):
        smtp_port = 587

    # Always log locally first for historical audits
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"======================================================================\n"
    log_entry += f"TIMESTAMP : {timestamp}\n"
    log_entry += f"TO        : {recipient}\n"
    log_entry += f"SUBJECT   : {subject}\n"
    log_entry += f"----------------------------------------------------------------------\n"
    log_entry += f"{body.strip()}\n"
    log_entry += f"======================================================================\n\n"
    
    with open(LOG_FILE, "a") as f:
        f.write(log_entry)

    # Send real email if configured
    if sender_email and app_password:
        try:
            msg = MIMEMultipart()
            msg['From'] = sender_email
            msg['To'] = recipient
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain'))

            server = smtplib.SMTP(smtp_host, smtp_port)
            server.starttls()
            server.login(sender_email, app_password)
            server.sendmail(sender_email, recipient, msg.as_string())
            server.quit()
            print(f"[EMAIL] Real email alert dispatched successfully to {recipient}")
        except Exception as e:
            print(f"[EMAIL ERROR] Failed to send real SMTP email: {e}")
    else:
        print(f"[EMAIL SIMULATION] Appended email warning to logs (SMTP not configured). Subject: {subject}")

def log_detection_alert(species, tracker_id, detect_time, brightness, confidence):
    """Formats and sends a simulated email warning for a new boundary intrusion."""
    subject = f"[ALERT] Live {species.replace('_', ' ').upper()} detected at farm boundaries! (Track #{tracker_id})"
    
    body = f"Alert: An animal intrusion event has occurred.\n\n"
    body += f"Species           : {species.replace('_', ' ').capitalize()}\n"
    body += f"Tracker ID        : #{tracker_id}\n"
    body += f"Detection Time    : {detect_time.strftime('%Y-%m-%d %H:%M:%S')}\n"
    body += f"Sensor Brightness : {brightness:.1f} Lux\n"
    body += f"YOLO Confidence   : {confidence * 100:.1f}%\n\n"
    body += f"Please review this alert in the FarmGuard Console and confirm if it is correct.\n"
    
    send_email_notification(subject, body)

def log_forecast_alert(species, predicted_time, confidence, peak_window):
    """Formats and sends a simulated email alert for an upcoming predicted intrusion window."""
    subject = f"[FORECAST] Predicted {species.replace('_', ' ').upper()} arrival window within next 30h!"
    
    body = f"Predictive Warning: An animal is expected to arrive soon.\n\n"
    body += f"Species           : {species.replace('_', ' ').capitalize()}\n"
    body += f"Expected Time     : {predicted_time}\n"
    body += f"AI Peak Window    : {peak_window}\n"
    body += f"Predictability    : {confidence:.1f}%\n\n"
    body += f"Please prepare active deterrents or secure crop boundaries for the scheduled hour.\n"
    
    send_email_notification(subject, body)

if __name__ == "__main__":
    # Test script execution
    print("Testing simulated notification outputs...")
    log_detection_alert("wild_boar", 881, datetime.now(), 22.4, 0.93)
    log_forecast_alert("elephant", "2026-07-13 04:30:00", 84.8, "04:00 - 04:59")
